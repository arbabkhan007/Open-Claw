// Write tool tests cover session path resolution and post-write recovery when
// remote or sandbox operations fail after persisting content.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expectDefined } from "@openclaw/normalization-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWriteTool, createWriteToolDefinition, type WriteOperations } from "./write.js";

describe("write tool", () => {
  let tmpDir = "";

  afterEach(async () => {
    if (tmpDir) {
      await fs.rm(tmpDir, { recursive: true, force: true });
      tmpDir = "";
    }
  });

  async function createTempPath(name = "demo.txt") {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-write-tool-"));
    return path.join(tmpDir, name);
  }

  function createRecoverableOperations(
    writeFile: WriteOperations["writeFile"],
    appendFile?: WriteOperations["appendFile"],
  ): WriteOperations {
    return {
      mkdir: (dir) => fs.mkdir(dir, { recursive: true }).then(() => {}),
      writeFile,
      appendFile,
      readFile: (absolutePath) => fs.readFile(absolutePath),
      statFile: async (absolutePath) => {
        try {
          const stat = await fs.stat(absolutePath);
          return {
            type: stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other",
            size: stat.size,
            mtimeMs: stat.mtimeMs,
          } as const;
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            (error as { code?: unknown }).code === "ENOENT"
          ) {
            return null;
          }
          throw error;
        }
      },
    };
  }

  it("recovers success after a post-write abort when readback matches requested content", async () => {
    // Remote transports can report cancellation after the write landed; verify
    // by readback before surfacing a false failure to the model.
    const filePath = await createTempPath();
    const expectedContent = "finished 😀\n";
    const controller = new AbortController();
    const tool = createWriteTool(tmpDir, {
      operations: createRecoverableOperations(async (absolutePath, content) => {
        await fs.writeFile(absolutePath, content, "utf-8");
        controller.abort();
        throw new Error("Operation aborted");
      }),
    });

    const result = await tool.execute(
      "call-1",
      { path: filePath, content: expectedContent },
      controller.signal,
    );

    expect(result.content[0]).toEqual({
      type: "text",
      text: `Successfully wrote ${Buffer.byteLength(expectedContent, "utf8")} bytes to ${filePath}`,
    });
  });

  it("keeps the original abort when the file already matched before execution", async () => {
    // Matching pre-existing content is not proof this call wrote successfully.
    const filePath = await createTempPath();
    await fs.writeFile(filePath, "finished\n", "utf-8");
    const controller = new AbortController();
    controller.abort();
    const tool = createWriteTool(tmpDir, {
      operations: createRecoverableOperations(async () => {
        throw new Error("Operation aborted");
      }),
    });

    await expect(
      tool.execute("call-1", { path: filePath, content: "finished\n" }, controller.signal),
    ).rejects.toThrow("Operation aborted");
  });

  it("recovers timeout-like post-write errors when readback matches requested content", async () => {
    const filePath = await createTempPath();
    const tool = createWriteTool(tmpDir, {
      operations: createRecoverableOperations(async (absolutePath, content) => {
        await fs.writeFile(absolutePath, content, "utf-8");
        throw new Error("node invoke timed out");
      }),
    });

    const result = await tool.execute(
      "call-1",
      { path: filePath, content: "finished\n" },
      undefined,
    );

    expect(result.content[0]?.type).toBe("text");
  });

  it("writes file URL paths through the shared session path resolver", async () => {
    const filePath = await createTempPath("notes.md");
    const tool = createWriteTool(tmpDir);

    await tool.execute(
      "call-1",
      { path: pathToFileURL(filePath).href, content: "finished\n" },
      undefined,
    );

    await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("finished\n");
  });

  it("returns terminal no-op when writing identical content to existing file", async () => {
    const filePath = await createTempPath("identical.txt");
    await fs.writeFile(filePath, "hello\n", "utf-8");
    const tool = createWriteTool(tmpDir);

    const result = await tool.execute(
      "call-1",
      { path: "identical.txt", content: "hello\n" },
      undefined,
    );

    const tc0 = expectDefined(result.content[0], "result.content[0] test invariant");
    expect("text" in tc0 ? tc0.text : "").toContain("No changes made");
    expect((result as { terminate?: boolean }).terminate).toBe(true);
    await expect(fs.readFile(filePath, "utf-8")).resolves.toBe("hello\n");
  });

  it("writes different content successfully (no false positive for no-op)", async () => {
    const filePath = await createTempPath("different.txt");
    const content = "new 😀\n";
    await fs.writeFile(filePath, "old\n", "utf-8");
    const tool = createWriteTool(tmpDir);

    const result = await tool.execute("call-1", { path: "different.txt", content }, undefined);

    expect(result.content[0]).toEqual({
      type: "text",
      text: `Successfully wrote ${Buffer.byteLength(content, "utf8")} bytes to different.txt`,
    });
    await expect(fs.readFile(filePath, "utf-8")).resolves.toBe(content);
  });

  it("appends to an existing file and reports byte length", async () => {
    const filePath = await createTempPath("append.txt");
    await fs.writeFile(filePath, "alpha\n", "utf8");
    const tool = createWriteTool(tmpDir);
    const content = "beta 😀\n";

    const result = await tool.execute(
      "call-append",
      { path: filePath, content, append: true },
      undefined,
    );

    expect(result.content[0]).toEqual({
      type: "text",
      text: `Successfully appended ${Buffer.byteLength(content, "utf8")} bytes to ${filePath}`,
    });
    expect(
      (tool as unknown as { parameters: { properties: Record<string, unknown> } }).parameters
        .properties,
    ).toHaveProperty("append");
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe(`alpha\n${content}`);
  });

  it("skips overwrite precheck operations before invoking the append backend", async () => {
    const filePath = await createTempPath("append-no-precheck.txt");
    await fs.writeFile(filePath, "seed\n", "utf8");
    const statFile = vi.fn(async () => ({ type: "file" as const, size: 5, mtimeMs: 1 }));
    const readFile = vi.fn(async () => await new Promise<Buffer>(() => {}));
    const appendFile = vi.fn(async (absolutePath: string, content: string) => {
      await fs.appendFile(absolutePath, content, "utf8");
    });
    const tool = createWriteTool(tmpDir, {
      operations: {
        mkdir: (dir) => fs.mkdir(dir, { recursive: true }).then(() => {}),
        writeFile: async () => {},
        appendFile,
        readFile,
        statFile,
      },
    });
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("append blocked in overwrite precheck")), 500);
    });

    try {
      await Promise.race([
        tool.execute("call-append-no-precheck", {
          path: filePath,
          content: "next\n",
          append: true,
        }),
        timeout,
      ]);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }

    expect(statFile).not.toHaveBeenCalled();
    expect(readFile).not.toHaveBeenCalled();
    expect(appendFile).toHaveBeenCalledTimes(1);
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("seed\nnext\n");
  });

  it("creates a missing file when append is true", async () => {
    const filePath = await createTempPath("nested/new.txt");
    const tool = createWriteTool(tmpDir);

    await tool.execute(
      "call-append-create",
      { path: filePath, content: "first\n", append: true },
      undefined,
    );

    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("first\n");
  });

  it("preserves intentional duplicate appends instead of using overwrite no-op detection", async () => {
    const filePath = await createTempPath("duplicate.txt");
    await fs.writeFile(filePath, "same\n", "utf8");
    const tool = createWriteTool(tmpDir);

    await tool.execute(
      "call-append-duplicate",
      { path: filePath, content: "same\n", append: true },
      undefined,
    );

    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("same\nsame\n");
  });

  it("rejects append before side effects when an injected backend has no append operation", async () => {
    const filePath = await createTempPath("unsupported/append.txt");
    let mkdirCalled = false;
    const tool = createWriteTool(tmpDir, {
      operations: {
        mkdir: async () => {
          mkdirCalled = true;
        },
        writeFile: async () => {},
      },
    });

    await expect(
      tool.execute(
        "call-append-unsupported",
        { path: filePath, content: "extra\n", append: true },
        undefined,
      ),
    ).rejects.toThrow("Append mode is not supported");
    expect(mkdirCalled).toBe(false);
    expect(
      (tool as unknown as { parameters: { properties: Record<string, unknown> } }).parameters
        .properties,
    ).not.toHaveProperty("append");
  });

  it("rejects malformed append values", async () => {
    const definition = createWriteToolDefinition(tmpDir);

    await expect(
      definition.execute(
        "call-append-invalid",
        { path: "bad.txt", content: "x", append: "true" } as never,
        undefined,
        undefined,
        {} as never,
      ),
    ).rejects.toThrow("Invalid append parameter");
  });

  it("reports success when cancellation arrives after the backend acknowledges append", async () => {
    const filePath = await createTempPath("append-abort.txt");
    await fs.writeFile(filePath, "seed\n", "utf8");
    const controller = new AbortController();
    const tool = createWriteTool(tmpDir, {
      operations: createRecoverableOperations(
        async () => {},
        async (absolutePath, content) => {
          await fs.appendFile(absolutePath, content, "utf8");
          controller.abort();
        },
      ),
    });

    const result = await tool.execute(
      "call-append-abort",
      { path: filePath, content: "more\n", append: true },
      controller.signal,
    );

    const firstContent = result.content[0];
    expect(firstContent?.type).toBe("text");
    expect(firstContent?.type === "text" ? firstContent.text : "").toContain(
      "Successfully appended",
    );
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("seed\nmore\n");
  });

  it("does not infer append success when the backend mutates but does not acknowledge", async () => {
    const filePath = await createTempPath("append-abort-unacknowledged.txt");
    await fs.writeFile(filePath, "seed\n", "utf8");
    const controller = new AbortController();
    const tool = createWriteTool(tmpDir, {
      operations: createRecoverableOperations(
        async () => {},
        async (absolutePath, content) => {
          await fs.appendFile(absolutePath, content, "utf8");
          controller.abort();
          throw new Error("Operation aborted");
        },
      ),
    });

    await expect(
      tool.execute(
        "call-append-abort-unacknowledged",
        { path: filePath, content: "more\n", append: true },
        controller.signal,
      ),
    ).rejects.toThrow(/Append outcome is uncertain; do not retry automatically/);
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("seed\nmore\n");
  });

  it("reports an uncertain append when cancellation lands before persistence", async () => {
    const filePath = await createTempPath("append-abort-before.txt");
    await fs.writeFile(filePath, "seed\n", "utf8");
    const controller = new AbortController();
    const tool = createWriteTool(tmpDir, {
      operations: createRecoverableOperations(
        async () => {},
        async () => {
          controller.abort();
          throw new Error("Operation aborted");
        },
      ),
    });

    await expect(
      tool.execute(
        "call-append-abort-before",
        { path: filePath, content: "more\n", append: true },
        controller.signal,
      ),
    ).rejects.toThrow(/Append outcome is uncertain; do not retry automatically/);
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("seed\n");
  });

  it("keeps cancellation before the append backend starts as a definite abort", async () => {
    const filePath = await createTempPath("append-abort-prestart.txt");
    await fs.writeFile(filePath, "seed\n", "utf8");
    const controller = new AbortController();
    controller.abort();
    const appendFile = vi.fn(async () => {});
    const tool = createWriteTool(tmpDir, {
      operations: createRecoverableOperations(async () => {}, appendFile),
    });

    await expect(
      tool.execute(
        "call-append-abort-prestart",
        { path: filePath, content: "more\n", append: true },
        controller.signal,
      ),
    ).rejects.toThrow(/^Operation aborted$/);
    expect(appendFile).not.toHaveBeenCalled();
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("seed\n");
  });

  it("reports a partial ENOSPC append as uncertain", async () => {
    const filePath = await createTempPath("append-enospc.txt");
    await fs.writeFile(filePath, "seed\n", "utf8");
    const tool = createWriteTool(tmpDir, {
      operations: createRecoverableOperations(
        async () => {},
        async (absolutePath) => {
          await fs.appendFile(absolutePath, "par", "utf8");
          const error = new Error("no space left on device") as NodeJS.ErrnoException;
          error.code = "ENOSPC";
          throw error;
        },
      ),
    });

    await expect(
      tool.execute(
        "call-append-enospc",
        { path: filePath, content: "partial\n", append: true },
        undefined,
      ),
    ).rejects.toThrow(/Append outcome is uncertain; do not retry automatically/);
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("seed\npar");
  });

  it("does not infer timeout recovery from content identical to the existing tail", async () => {
    const filePath = await createTempPath("append-timeout-duplicate.txt");
    await fs.writeFile(filePath, "same\n", "utf8");
    const tool = createWriteTool(tmpDir, {
      operations: createRecoverableOperations(
        async () => {},
        async (absolutePath, content) => {
          await fs.appendFile(absolutePath, content, "utf8");
          throw new Error("remote append timed out");
        },
      ),
    });

    await expect(
      tool.execute(
        "call-append-timeout",
        { path: filePath, content: "same\n", append: true },
        undefined,
      ),
    ).rejects.toThrow(/Append outcome is uncertain; do not retry automatically/);
    await expect(fs.readFile(filePath, "utf8")).resolves.toBe("same\nsame\n");
  });
});
