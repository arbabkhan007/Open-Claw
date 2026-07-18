#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/android-screenshots.sh [--form-factor phone|wear|all] [--device <adb-serial>] [--avd <name>] [--locale en-US] [--skip-build] [--skip-install] [--keep-emulator] [--dry-run]

Builds and installs the selected debug app on an emulator, launches current screens
with deterministic local fixture state, and writes Google Play screenshots under
the locale's phoneScreenshots/ or wearScreenshots/ directory.

Capture evidence is saved under a form-factor- and locale-specific .artifacts directory.

Phone capture defaults to a retained Pixel 2 AVD with no display cutout. Wear
capture defaults to a retained API 36 large-round Wear OS AVD. Use --avd or
--device to override the selected form factor's target.
EOF
}

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ANDROID_DIR="${ROOT_DIR}/apps/android"
case "$(uname -m)" in
  arm64|aarch64) DEFAULT_SCREENSHOT_ABI="arm64-v8a" ;;
  *) DEFAULT_SCREENSHOT_ABI="x86_64" ;;
esac
FORM_FACTOR="${ANDROID_SCREENSHOT_FORM_FACTOR:-phone}"
LOCALE="en-US"
DEVICE_OVERRIDE=""
AVD_OVERRIDE=""
KEEP_EMULATOR="${ANDROID_SCREENSHOT_KEEP_EMULATOR:-0}"
SKIP_BUILD=0
SKIP_INSTALL=0
DRY_RUN=0
EMULATOR_PID=""
EMULATOR_LOG=""
STARTED_EMULATOR=0
DISPLAY_OVERRIDDEN=0
ORIGINAL_WM_SIZE=""
ORIGINAL_WM_DENSITY=""
SCREENSHOT_DENSITY=""
SOURCE_GIT_SHA=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      ;;
    --form-factor)
      FORM_FACTOR="${2:-}"
      shift 2
      ;;
    --device)
      DEVICE_OVERRIDE="${2:-}"
      shift 2
      ;;
    --avd)
      AVD_OVERRIDE="${2:-}"
      shift 2
      ;;
    --locale)
      LOCALE="${2:-}"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    --skip-install)
      SKIP_INSTALL=1
      shift
      ;;
    --keep-emulator)
      KEEP_EMULATOR=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "$FORM_FACTOR" == "all" ]]; then
  if [[ -n "$DEVICE_OVERRIDE" || -n "$AVD_OVERRIDE" ]]; then
    echo "--device and --avd require --form-factor phone or wear." >&2
    echo "Use form-specific ANDROID_SCREENSHOT_PHONE_* and ANDROID_SCREENSHOT_WEAR_* overrides for an all-form-factor capture." >&2
    exit 1
  fi
  all_args=(--locale "$LOCALE")
  if [[ "$SKIP_BUILD" == "1" ]]; then
    all_args+=(--skip-build)
  fi
  if [[ "$SKIP_INSTALL" == "1" ]]; then
    all_args+=(--skip-install)
  fi
  if [[ "$KEEP_EMULATOR" == "1" ]]; then
    all_args+=(--keep-emulator)
  fi
  if [[ "$DRY_RUN" == "1" ]]; then
    all_args+=(--dry-run)
  fi
  bash "${ROOT_DIR}/scripts/android-screenshots.sh" --form-factor phone "${all_args[@]}"
  bash "${ROOT_DIR}/scripts/android-screenshots.sh" --form-factor wear "${all_args[@]}"
  exit 0
fi

case "$FORM_FACTOR" in
  phone)
    DEVICE="${DEVICE_OVERRIDE:-${ANDROID_SCREENSHOT_PHONE_DEVICE:-${ANDROID_SCREENSHOT_DEVICE:-}}}"
    AVD="${AVD_OVERRIDE:-${ANDROID_SCREENSHOT_PHONE_AVD:-${ANDROID_SCREENSHOT_AVD:-OpenClaw_Screenshots_API36}}}"
    SCREENSHOT_DEVICE_PROFILE="${ANDROID_SCREENSHOT_PHONE_DEVICE_PROFILE:-${ANDROID_SCREENSHOT_DEVICE_PROFILE:-pixel_2}}"
    SCREENSHOT_SYSTEM_IMAGE="${ANDROID_SCREENSHOT_PHONE_SYSTEM_IMAGE:-${ANDROID_SCREENSHOT_SYSTEM_IMAGE:-system-images;android-36;google_apis;${DEFAULT_SCREENSHOT_ABI}}}"
    SCREENSHOT_SIZE="${ANDROID_SCREENSHOT_PHONE_SIZE:-${ANDROID_SCREENSHOT_SIZE:-1440x2560}}"
    SCREENSHOT_SETTLE_SECONDS="${ANDROID_SCREENSHOT_PHONE_SETTLE_SECONDS:-${ANDROID_SCREENSHOT_SETTLE_SECONDS:-0.5}}"
    SCREENSHOT_EMULATOR_ARGS="${ANDROID_SCREENSHOT_PHONE_EMULATOR_ARGS:-${ANDROID_SCREENSHOT_EMULATOR_ARGS:-}}"
    ARTIFACT_ROOT="${ROOT_DIR}/.artifacts/android-screenshots/latest"
    SYSTEM_IMAGE_ENV_VAR="ANDROID_SCREENSHOT_PHONE_SYSTEM_IMAGE"
    SCREENSHOT_TYPE="phoneScreenshots"
    GRADLE_TASK=":app:assemblePlayDebug"
    APK_OUTPUT_DIR="${ANDROID_DIR}/app/build/outputs/apk/play/debug"
    APK_PATTERN="*-play-debug.apk"
    ACTIVITY_COMPONENT="ai.openclaw.app/.MainActivity"
    SCENES=(home chat voice settings gateway voice-wake)
    ;;
  wear)
    DEVICE="${DEVICE_OVERRIDE:-${ANDROID_SCREENSHOT_WEAR_DEVICE:-}}"
    AVD="${AVD_OVERRIDE:-${ANDROID_SCREENSHOT_WEAR_AVD:-OpenClaw_Wear_Screenshots_API36}}"
    SCREENSHOT_DEVICE_PROFILE="${ANDROID_SCREENSHOT_WEAR_DEVICE_PROFILE:-wearos_large_round}"
    SCREENSHOT_SYSTEM_IMAGE="${ANDROID_SCREENSHOT_WEAR_SYSTEM_IMAGE:-system-images;android-36;android-wear-signed;${DEFAULT_SCREENSHOT_ABI}}"
    SCREENSHOT_SIZE="${ANDROID_SCREENSHOT_WEAR_SIZE:-454x454}"
    SCREENSHOT_SETTLE_SECONDS="${ANDROID_SCREENSHOT_WEAR_SETTLE_SECONDS:-2}"
    SCREENSHOT_EMULATOR_ARGS="${ANDROID_SCREENSHOT_WEAR_EMULATOR_ARGS:-}"
    ARTIFACT_ROOT="${ROOT_DIR}/.artifacts/android-wear-screenshots/latest"
    SYSTEM_IMAGE_ENV_VAR="ANDROID_SCREENSHOT_WEAR_SYSTEM_IMAGE"
    SCREENSHOT_TYPE="wearScreenshots"
    GRADLE_TASK=":wear:assembleDebug"
    APK_OUTPUT_DIR="${ANDROID_DIR}/wear/build/outputs/apk/debug"
    APK_PATTERN="*-debug.apk"
    ACTIVITY_COMPONENT="ai.openclaw.app/ai.openclaw.wear.WearScreenshotActivity"
    SCENES=(chat voice agents sessions controls)
    ;;
  *)
    echo "Invalid Android screenshot form factor: ${FORM_FACTOR}" >&2
    echo "Use --form-factor phone, wear, or all." >&2
    exit 1
    ;;
esac

PACKAGE_ID="ai.openclaw.app"

validate_locale() {
  local locale="$1"
  if [[ "$locale" =~ ^[A-Za-z0-9][A-Za-z0-9_-]*$ ]]; then
    return
  fi
  echo "Invalid Android screenshot locale: ${locale}" >&2
  echo "Use a locale tag like en-US or pt-BR; path separators and dot segments are not allowed." >&2
  exit 1
}

validate_locale "$LOCALE"
ARTIFACT_DIR="${ARTIFACT_ROOT}/${LOCALE}"

if [[ ! "$SCREENSHOT_SIZE" =~ ^[0-9]+x[0-9]+$ ]]; then
  echo "Invalid Android screenshot size: ${SCREENSHOT_SIZE}" >&2
  echo "Use a pixel size like 1080x1920." >&2
  exit 1
fi
SCREENSHOT_WIDTH=$((10#${SCREENSHOT_SIZE%x*}))
SCREENSHOT_HEIGHT=$((10#${SCREENSHOT_SIZE#*x}))
SCREENSHOT_MIN_DIMENSION=$((SCREENSHOT_WIDTH < SCREENSHOT_HEIGHT ? SCREENSHOT_WIDTH : SCREENSHOT_HEIGHT))
SCREENSHOT_MAX_DIMENSION=$((SCREENSHOT_WIDTH > SCREENSHOT_HEIGHT ? SCREENSHOT_WIDTH : SCREENSHOT_HEIGHT))
if [[ "$FORM_FACTOR" == "wear" ]] &&
  (( SCREENSHOT_WIDTH != SCREENSHOT_HEIGHT || SCREENSHOT_MIN_DIMENSION < 384 || SCREENSHOT_MAX_DIMENSION > 3840 )); then
  echo "Wear screenshot size ${SCREENSHOT_SIZE} must be square, at least 384x384, and no larger than 3840x3840." >&2
  exit 1
fi
if [[ "$FORM_FACTOR" == "phone" ]] &&
  (( SCREENSHOT_MIN_DIMENSION < 320 || SCREENSHOT_MAX_DIMENSION > 3840 || SCREENSHOT_MAX_DIMENSION > SCREENSHOT_MIN_DIMENSION * 2 )); then
  echo "Android screenshot size ${SCREENSHOT_SIZE} does not meet Google Play dimension and aspect-ratio limits." >&2
  exit 1
fi

wait_for_device_disconnect() {
  local adb="$1"
  local serial="$2"
  local timeout_seconds="${ANDROID_SCREENSHOT_SHUTDOWN_TIMEOUT_SECONDS:-30}"
  local deadline=$((SECONDS + timeout_seconds))
  local state

  while (( SECONDS < deadline )); do
    state="$("$adb" -s "$serial" get-state 2>/dev/null || true)"
    if [[ "$state" != "device" ]]; then
      return
    fi
    sleep 1
  done

  echo "Timed out waiting for Android emulator ${serial} to disconnect." >&2
  return 1
}

cleanup_started_emulator() {
  local stopped=0

  if [[ "$STARTED_EMULATOR" != "1" || "$KEEP_EMULATOR" == "1" ]]; then
    return
  fi
  if [[ -n "${ADB_BIN:-}" && -n "${ADB_SERIAL:-}" ]]; then
    if "$ADB_BIN" -s "$ADB_SERIAL" emu kill >/dev/null 2>&1; then
      stopped=1
    fi
  fi
  if [[ "$stopped" != "1" && -n "$EMULATOR_PID" ]]; then
    kill "$EMULATOR_PID" >/dev/null 2>&1 || true
  fi
  if [[ -n "${ADB_BIN:-}" && -n "${ADB_SERIAL:-}" ]]; then
    wait_for_device_disconnect "$ADB_BIN" "$ADB_SERIAL" || true
  fi
}

restore_device_display() {
  if [[ "$DISPLAY_OVERRIDDEN" != "1" || -z "${ADB_BIN:-}" || -z "${ADB_SERIAL:-}" ]]; then
    return
  fi
  if [[ -n "$ORIGINAL_WM_SIZE" ]]; then
    "$ADB_BIN" -s "$ADB_SERIAL" shell wm size "$ORIGINAL_WM_SIZE" >/dev/null 2>&1 || true
  else
    "$ADB_BIN" -s "$ADB_SERIAL" shell wm size reset >/dev/null 2>&1 || true
  fi
  if [[ -n "$ORIGINAL_WM_DENSITY" ]]; then
    "$ADB_BIN" -s "$ADB_SERIAL" shell wm density "$ORIGINAL_WM_DENSITY" >/dev/null 2>&1 || true
  else
    "$ADB_BIN" -s "$ADB_SERIAL" shell wm density reset >/dev/null 2>&1 || true
  fi
}

cleanup_emulator_log() {
  if [[ -n "$EMULATOR_LOG" && -f "$EMULATOR_LOG" ]]; then
    rm -f "$EMULATOR_LOG"
  fi
}

cleanup() {
  restore_device_display
  cleanup_started_emulator
  cleanup_emulator_log
}

trap cleanup EXIT

adb_bin() {
  if [[ -n "${ADB:-}" ]]; then
    printf '%s\n' "$ADB"
    return
  fi
  if command -v adb >/dev/null 2>&1; then
    command -v adb
    return
  fi
  for sdk_root in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Library/Android/sdk"; do
    if [[ -n "$sdk_root" && -x "$sdk_root/platform-tools/adb" ]]; then
      printf '%s\n' "$sdk_root/platform-tools/adb"
      return
    fi
  done
  echo "adb not found. Install Android platform-tools or set ADB." >&2
  return 127
}

emulator_bin() {
  if [[ -n "${ANDROID_EMULATOR:-}" ]]; then
    printf '%s\n' "$ANDROID_EMULATOR"
    return
  fi
  if command -v emulator >/dev/null 2>&1; then
    command -v emulator
    return
  fi
  for sdk_root in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Library/Android/sdk"; do
    if [[ -n "$sdk_root" && -x "$sdk_root/emulator/emulator" ]]; then
      printf '%s\n' "$sdk_root/emulator/emulator"
      return
    fi
  done
  echo "Android emulator binary not found. Install the Android emulator or set ANDROID_EMULATOR." >&2
  return 127
}

avdmanager_bin() {
  if [[ -n "${AVDMANAGER:-}" ]]; then
    printf '%s\n' "$AVDMANAGER"
    return
  fi
  if command -v avdmanager >/dev/null 2>&1; then
    command -v avdmanager
    return
  fi
  for sdk_root in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Library/Android/sdk"; do
    for relative_path in cmdline-tools/latest/bin/avdmanager cmdline-tools/bin/avdmanager tools/bin/avdmanager; do
      if [[ -n "$sdk_root" && -x "$sdk_root/$relative_path" ]]; then
        printf '%s\n' "$sdk_root/$relative_path"
        return
      fi
    done
  done
  echo "avdmanager not found. Install Android SDK command-line tools or set AVDMANAGER." >&2
  return 127
}

ensure_screenshot_avd() {
  local avd="$1"
  local emulator
  local avdmanager

  emulator="$(emulator_bin)"
  if "$emulator" -list-avds | grep -Fxq "$avd"; then
    return
  fi

  avdmanager="$(avdmanager_bin)"
  echo "Creating ${FORM_FACTOR} screenshot AVD '${avd}' from device profile '${SCREENSHOT_DEVICE_PROFILE}'." >&2
  if ! printf 'no\n' | "$avdmanager" create avd \
    --force \
    --name "$avd" \
    --package "$SCREENSHOT_SYSTEM_IMAGE" \
    --device "$SCREENSHOT_DEVICE_PROFILE"; then
    echo "Could not create Android screenshot AVD '${avd}'." >&2
    echo "Install SDK package '${SCREENSHOT_SYSTEM_IMAGE}' or set ${SYSTEM_IMAGE_ENV_VAR}." >&2
    return 1
  fi
}

connected_devices() {
  local adb="$1"
  "$adb" devices | awk 'NR > 1 && $2 == "device" { print $1 }'
}

device_count() {
  local devices="$1"
  printf '%s\n' "$devices" | sed '/^$/d' | wc -l | tr -d ' '
}

running_avd_name() {
  local adb="$1"
  local serial="$2"
  "$adb" -s "$serial" emu avd name 2>/dev/null | tr -d '\r' | sed -n '1p'
}

connected_avd_serials() {
  local adb="$1"
  local avd="$2"
  local devices
  local serial
  local connected_avd

  devices="$(connected_devices "$adb")"
  while IFS= read -r serial; do
    [[ -n "$serial" ]] || continue
    connected_avd="$(running_avd_name "$adb" "$serial" || true)"
    if [[ "$connected_avd" == "$avd" ]]; then
      printf '%s\n' "$serial"
    fi
  done <<<"$devices"
}

wait_for_target_avd() {
  local adb="$1"
  local avd="$2"
  local timeout_seconds="${ANDROID_SCREENSHOT_EMULATOR_TIMEOUT_SECONDS:-180}"
  local deadline=$((SECONDS + timeout_seconds))
  local matches
  local count

  while (( SECONDS < deadline )); do
    matches="$(connected_avd_serials "$adb" "$avd")"
    count="$(device_count "$matches")"
    if [[ "$count" == "1" ]]; then
      printf '%s\n' "$matches"
      return
    fi
    if (( count > 1 )); then
      echo "Multiple connected emulators report the target AVD '${avd}':" >&2
      printf '%s\n' "$matches" >&2
      return 1
    fi
    sleep 2
  done

  echo "Timed out waiting for screenshot AVD '${avd}' to connect." >&2
  "$adb" devices -l >&2 || true
  return 1
}

wait_for_boot_completed() {
  local adb="$1"
  local serial="$2"
  local timeout_seconds="${ANDROID_SCREENSHOT_EMULATOR_TIMEOUT_SECONDS:-180}"
  local deadline=$((SECONDS + timeout_seconds))
  local boot_completed

  "$adb" -s "$serial" wait-for-device
  while (( SECONDS < deadline )); do
    boot_completed="$("$adb" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
    if [[ "$boot_completed" == "1" ]]; then
      "$adb" -s "$serial" shell input keyevent 82 >/dev/null 2>&1 || true
      return
    fi
    sleep 2
  done

  echo "Timed out waiting for Android emulator boot completion on ${serial}." >&2
  return 1
}

wait_for_explicit_device() {
  local adb="$1"
  local serial="$2"
  local timeout_seconds="${ANDROID_SCREENSHOT_DEVICE_TIMEOUT_SECONDS:-30}"
  local deadline=$((SECONDS + timeout_seconds))
  local state

  while (( SECONDS < deadline )); do
    state="$("$adb" devices | awk -v serial="$serial" '$1 == serial { print $2 }')"
    if [[ "$state" == "device" ]]; then
      return
    fi
    sleep 2
  done

  if [[ -n "$state" ]]; then
    echo "Android device '${serial}' did not become usable within ${timeout_seconds}s; current adb state is '${state}'." >&2
  else
    echo "Android device '${serial}' was not found within ${timeout_seconds}s." >&2
  fi
  "$adb" devices -l >&2 || true
  return 1
}

stabilize_device_for_screenshots() {
  local adb="$1"
  local serial="$2"
  "$adb" -s "$serial" shell settings put global window_animation_scale 0 >/dev/null 2>&1 || true
  "$adb" -s "$serial" shell settings put global transition_animation_scale 0 >/dev/null 2>&1 || true
  "$adb" -s "$serial" shell settings put global animator_duration_scale 0 >/dev/null 2>&1 || true
  "$adb" -s "$serial" shell settings put system font_scale 1.0 >/dev/null 2>&1 || true
}

require_emulator_device() {
  local adb="$1"
  local serial="$2"
  local qemu

  qemu="$("$adb" -s "$serial" shell getprop ro.kernel.qemu 2>/dev/null | tr -d '\r')"
  if [[ "$qemu" == "1" ]]; then
    return
  fi
  echo "Android screenshot capture requires an emulator; '${serial}' is not an emulator." >&2
  echo "Pass --avd <name> or --device <emulator-serial>." >&2
  return 1
}

require_device_form_factor() {
  local adb="$1"
  local serial="$2"
  local features
  local is_watch=false

  if ! features="$("$adb" -s "$serial" shell pm list features 2>/dev/null | tr -d '\r')"; then
    echo "Could not determine the Android form factor for '${serial}'." >&2
    return 1
  fi
  if grep -Fxq "feature:android.hardware.type.watch" <<<"$features"; then
    is_watch=true
  fi
  if [[ "$FORM_FACTOR" == "wear" && "$is_watch" != "true" ]]; then
    echo "Wear screenshot capture requires a Wear OS emulator; '${serial}' reports a non-watch form factor." >&2
    return 1
  fi
  if [[ "$FORM_FACTOR" == "phone" && "$is_watch" != "false" ]]; then
    echo "Phone screenshot capture cannot use a Wear OS emulator; '${serial}' reports a watch form factor." >&2
    return 1
  fi
}

configure_screenshot_display() {
  local adb="$1"
  local serial="$2"
  local current_size
  local current_density
  local effective_size
  local effective_density
  local effective_width

  current_size="$("$adb" -s "$serial" shell wm size 2>/dev/null | tr -d '\r')"
  current_density="$("$adb" -s "$serial" shell wm density 2>/dev/null | tr -d '\r')"
  ORIGINAL_WM_SIZE="$(printf '%s\n' "$current_size" | sed -n 's/^Override size: //p')"
  ORIGINAL_WM_DENSITY="$(printf '%s\n' "$current_density" | sed -n 's/^Override density: //p')"
  effective_size="${ORIGINAL_WM_SIZE:-$(printf '%s\n' "$current_size" | sed -n 's/^Physical size: //p')}"
  effective_density="${ORIGINAL_WM_DENSITY:-$(printf '%s\n' "$current_density" | sed -n 's/^Physical density: //p')}"
  if [[ ! "$effective_size" =~ ^[0-9]+x[0-9]+$ || ! "$effective_density" =~ ^[0-9]+$ ]]; then
    echo "Could not determine emulator display size and density." >&2
    return 1
  fi

  effective_width=$((10#${effective_size%x*}))
  SCREENSHOT_DENSITY=$(((10#$effective_density * SCREENSHOT_WIDTH + effective_width / 2) / effective_width))
  DISPLAY_OVERRIDDEN=1
  "$adb" -s "$serial" shell wm size "$SCREENSHOT_SIZE" >/dev/null
  "$adb" -s "$serial" shell wm density "$SCREENSHOT_DENSITY" >/dev/null
  echo "Android screenshot density: ${SCREENSHOT_DENSITY} dpi"
}

boot_emulator() {
  local adb="$1"
  local avd="$2"
  local emulator
  local emulator_args
  local extra_args
  local serial

  ensure_screenshot_avd "$avd"
  emulator="$(emulator_bin)"
  EMULATOR_LOG="$(mktemp "${TMPDIR:-/tmp}/openclaw-android-screenshot-emulator.XXXXXX.log")"
  echo "Booting screenshot AVD '${avd}'." >&2
  emulator_args=(-avd "$avd" -no-window -no-audio -no-boot-anim)
  if [[ -n "$SCREENSHOT_EMULATOR_ARGS" ]]; then
    read -r -a extra_args <<<"$SCREENSHOT_EMULATOR_ARGS"
    emulator_args+=("${extra_args[@]}")
  fi
  "$emulator" "${emulator_args[@]}" >"$EMULATOR_LOG" 2>&1 &
  EMULATOR_PID="$!"
  STARTED_EMULATOR=1

  serial="$(wait_for_target_avd "$adb" "$avd")"
  wait_for_boot_completed "$adb" "$serial"
  stabilize_device_for_screenshots "$adb" "$serial"
  ADB_SERIAL="$serial"
}

resolve_device() {
  local adb="$1"
  local matches
  local count

  if [[ -n "$DEVICE" ]]; then
    wait_for_explicit_device "$adb" "$DEVICE"
    stabilize_device_for_screenshots "$adb" "$DEVICE"
    ADB_SERIAL="$DEVICE"
    return
  fi
  matches="$(connected_avd_serials "$adb" "$AVD")"
  count="$(device_count "$matches")"
  if [[ "$count" == "1" ]]; then
    stabilize_device_for_screenshots "$adb" "$matches"
    ADB_SERIAL="$matches"
    return
  fi
  if [[ "$count" == "0" ]]; then
    boot_emulator "$adb" "$AVD"
    return
  fi
  echo "Multiple connected emulators report the screenshot AVD '${AVD}'. Pass --device <adb-serial>." >&2
  printf '%s\n' "$matches" >&2
  return 1
}

latest_debug_apk() {
  if [[ ! -d "$APK_OUTPUT_DIR" ]]; then
    return 0
  fi
  find "$APK_OUTPUT_DIR" -maxdepth 1 -name "$APK_PATTERN" -print 2>/dev/null | sort | tail -n 1
}

scene_ready_text() {
  case "${FORM_FACTOR}:$1" in
    phone:home) printf '%s\n' "Overview" ;;
    phone:chat) printf '%s\n' "Ready when you are" ;;
    phone:voice) printf '%s\n' "Ready to talk" ;;
    phone:settings) printf '%s\n' "OpenClaw mobile" ;;
    phone:voice-wake) printf '%s\n' "Wake listener" ;;
    # Connected fixtures can push Add Gateway below the composed viewport, so
    # wait for the gateway detail's always-visible subtitle instead.
    phone:gateway) printf '%s\n' "Connection between this phone and OpenClaw." ;;
    wear:chat) printf '%s\n' "CHAT" ;;
    wear:voice) printf '%s\n' "Dictate" ;;
    wear:agents) printf '%s\n' "AGENTS" ;;
    wear:sessions) printf '%s\n' "SESSIONS" ;;
    wear:controls) printf '%s\n' "CONTROLS" ;;
    *)
      echo "Unknown Android screenshot scene: $1" >&2
      return 1
      ;;
  esac
}

wait_for_scene_ready() {
  local adb="$1"
  local serial="$2"
  local scene="$3"
  local dump_path="$4"
  local marker
  local timeout_seconds="${ANDROID_SCREENSHOT_SCENE_TIMEOUT_SECONDS:-45}"
  local deadline=$((SECONDS + timeout_seconds))

  marker="$(scene_ready_text "$scene")"
  while (( SECONDS < deadline )); do
    if "$adb" -s "$serial" exec-out uiautomator dump /dev/tty >"$dump_path" 2>/dev/null; then
      if grep -Fq "$marker" "$dump_path"; then
        return
      fi
    fi
    sleep 1
  done

  echo "Timed out waiting for scene '${scene}' to expose '${marker}' in the Android UI tree." >&2
  return 1
}

launch_scene() {
  local adb="$1"
  local serial="$2"
  local scene="$3"
  local activity_start_path="$4"
  local launch_args

  launch_args=(
    -s "$serial" shell am start -W
    -n "$ACTIVITY_COMPONENT"
  )
  if [[ "$FORM_FACTOR" == "phone" ]]; then
    launch_args+=(--ez openclaw.screenshotMode true)
  else
    # Start each debug fixture as a fresh task so saved pager state cannot leak
    # between store scenes.
    launch_args+=(--activity-new-task --activity-clear-task)
  fi
  launch_args+=(--es openclaw.screenshotScene "$scene")
  "$adb" "${launch_args[@]}" >"$activity_start_path"
}

sips_bin() {
  if [[ -n "${SIPS:-}" ]]; then
    printf '%s\n' "$SIPS"
    return
  fi
  if command -v sips >/dev/null 2>&1; then
    command -v sips
    return
  fi
  echo "sips not found. Android release screenshots require macOS or an explicit SIPS executable." >&2
  return 127
}

normalize_capture_for_play() {
  local input_path="$1"
  local output_path="$2"
  local sips
  local description

  sips="$(sips_bin)"
  "$sips" -s format jpeg -s formatOptions best "$input_path" --out "$output_path" >/dev/null
  rm -f "$input_path"

  description="$(file "$output_path")"
  if [[ "$description" != *"${SCREENSHOT_SIZE/x/x}"* || "$description" != *"JPEG image data"* ]]; then
    echo "Invalid Google Play screenshot output: ${description}" >&2
    return 1
  fi
}

write_artifact_manifest() {
  local serial="$1"
  local avd_name
  local checksum
  local git_sha
  local checksum_command
  local relative_path
  local scene
  local screenshot_path

  avd_name="$(running_avd_name "$ADB_BIN" "$serial")"
  git_sha="$SOURCE_GIT_SHA"
  if command -v shasum >/dev/null 2>&1; then
    checksum_command=(shasum -a 256)
  else
    checksum_command=(sha256sum)
  fi

  {
    printf 'git_sha=%s\n' "$git_sha"
    printf 'form_factor=%s\n' "$FORM_FACTOR"
    printf 'device=%s\n' "$serial"
    printf 'avd=%s\n' "${avd_name:-unknown}"
    printf 'component=%s\n' "$ACTIVITY_COMPONENT"
    printf 'gradle_task=%s\n' "$GRADLE_TASK"
    printf 'locale=%s\n' "$LOCALE"
    printf 'size=%s\n' "$SCREENSHOT_SIZE"
    printf 'density=%s\n' "$SCREENSHOT_DENSITY"
    printf 'format=high-quality JPEG\n'
    printf 'scenes=%s\n' "${SCENES[*]}"
    for screenshot_path in "$OUTPUT_DIR"/*.jpg; do
      scene="$(basename "$screenshot_path" .jpg)"
      scene="${scene#openclaw-}"
      relative_path="${screenshot_path#"$ROOT_DIR"/}"
      checksum="$("${checksum_command[@]}" "$screenshot_path" | awk '{ print $1 }')"
      printf 'screenshot.%s.path=%s\n' "$scene" "$relative_path"
      printf 'screenshot.%s.sha256=%s\n' "$scene" "$checksum"
    done
  } >"$ARTIFACT_DIR/manifest.txt"
}

OUTPUT_DIR="${ANDROID_DIR}/fastlane/metadata/android/${LOCALE}/images/${SCREENSHOT_TYPE}"
ADB_SERIAL=""
ADB_DISPLAY="${DEVICE:-<auto>}"

echo "Android screenshot form factor: ${FORM_FACTOR}"
echo "Android screenshot output: ${OUTPUT_DIR}"
echo "Android screenshot artifacts: ${ARTIFACT_DIR}"
echo "Android screenshot size: ${SCREENSHOT_SIZE}"
echo "Android screenshot component: ${ACTIVITY_COMPONENT}"
echo "Android screenshot Gradle task: ${GRADLE_TASK}"
echo "Scenes: ${SCENES[*]}"
echo "ADB device: ${ADB_DISPLAY}"
echo "Screenshot AVD: ${AVD}"
echo "Screenshot device profile: ${SCREENSHOT_DEVICE_PROFILE}"
echo "Screenshot system image: ${SCREENSHOT_SYSTEM_IMAGE}"

if [[ "$DRY_RUN" == "1" ]]; then
  echo "Dry run complete. No build, install, or capture commands were executed."
  exit 0
fi

SOURCE_GIT_SHA="$(git -C "$ROOT_DIR" rev-parse --verify HEAD)"
node --import tsx "${ROOT_DIR}/scripts/lib/android-release-source.ts" \
  --root "$ROOT_DIR" \
  --expected-commit "$SOURCE_GIT_SHA"

ADB_BIN="$(adb_bin)"
resolve_device "$ADB_BIN"
require_emulator_device "$ADB_BIN" "$ADB_SERIAL"
require_device_form_factor "$ADB_BIN" "$ADB_SERIAL"
configure_screenshot_display "$ADB_BIN" "$ADB_SERIAL"
mkdir -p "$OUTPUT_DIR"
rm -f "$OUTPUT_DIR"/*.png "$OUTPUT_DIR"/*.jpg "$OUTPUT_DIR"/*.jpeg
rm -rf "$ARTIFACT_DIR"
mkdir -p "$ARTIFACT_DIR/screenshots" "$ARTIFACT_DIR/ui-dumps" "$ARTIFACT_DIR/activity-start"

if [[ "$SKIP_INSTALL" != "1" ]]; then
  if [[ "$SKIP_BUILD" != "1" ]]; then
    (
      cd "$ANDROID_DIR"
      ./gradlew "$GRADLE_TASK"
    )
  fi
  APK_PATH="$(latest_debug_apk)"
  if [[ -z "$APK_PATH" ]]; then
    echo "No existing ${FORM_FACTOR} debug APK found. Run without --skip-build first." >&2
    exit 1
  fi
  "$ADB_BIN" -s "$ADB_SERIAL" install -r "$APK_PATH" >/dev/null
elif [[ "$SKIP_BUILD" != "1" ]]; then
  (
    cd "$ANDROID_DIR"
    ./gradlew "$GRADLE_TASK"
  )
fi

"$ADB_BIN" -s "$ADB_SERIAL" shell pm clear "$PACKAGE_ID" >/dev/null
if [[ "$FORM_FACTOR" == "phone" ]]; then
  "$ADB_BIN" -s "$ADB_SERIAL" shell pm grant "$PACKAGE_ID" android.permission.RECORD_AUDIO >/dev/null
fi
"$ADB_BIN" -s "$ADB_SERIAL" logcat -c >/dev/null 2>&1 || true

for scene in "${SCENES[@]}"; do
  output_path="${OUTPUT_DIR}/openclaw-${scene}.jpg"
  raw_path="${OUTPUT_DIR}/openclaw-${scene}.raw.png"
  artifact_path="${ARTIFACT_DIR}/screenshots/openclaw-${scene}.jpg"
  ui_dump_path="${ARTIFACT_DIR}/ui-dumps/openclaw-${scene}.xml"
  activity_start_path="${ARTIFACT_DIR}/activity-start/openclaw-${scene}.txt"
  "$ADB_BIN" -s "$ADB_SERIAL" shell am force-stop "$PACKAGE_ID" >/dev/null
  launch_scene "$ADB_BIN" "$ADB_SERIAL" "$scene" "$activity_start_path"
  wait_for_scene_ready "$ADB_BIN" "$ADB_SERIAL" "$scene" "$ui_dump_path"
  sleep "$SCREENSHOT_SETTLE_SECONDS"
  "$ADB_BIN" -s "$ADB_SERIAL" exec-out screencap -p >"$raw_path"
  normalize_capture_for_play "$raw_path" "$output_path"
  cp "$output_path" "$artifact_path"
  echo "Captured ${output_path}"
done

"$ADB_BIN" -s "$ADB_SERIAL" logcat -d >"$ARTIFACT_DIR/logcat.txt" 2>&1 || true
if [[ -n "$EMULATOR_LOG" && -f "$EMULATOR_LOG" ]]; then
  cp "$EMULATOR_LOG" "$ARTIFACT_DIR/emulator.log"
fi
write_artifact_manifest "$ADB_SERIAL"

echo "Android screenshots written to ${OUTPUT_DIR}"
echo "Android screenshot artifacts written to ${ARTIFACT_DIR}"
