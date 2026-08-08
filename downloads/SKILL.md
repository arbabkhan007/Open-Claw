---
name: snail-listing-studio
description: Create and QA original crochet snail product concepts, Etsy listing copy, pattern briefs, and launch checklists without copying third-party designs.
---

# Snail Listing Studio

Use this workflow when the user wants to develop an original crochet snail product or Etsy listing from a market reference.

## Guardrails

- Treat competitor listings as market research only.
- Never reproduce their photos, text, brand names, pattern rounds, distinctive construction, or signature variations.
- Ask for the user's own sample details before making factual claims about size, materials, skill level, safety, or production time.
- Clearly distinguish a digital pattern from a finished physical item.
- Avoid guarantees about sales, ranking, demand, or Etsy policy. Mark assumptions for verification.

## Workflow

1. Extract broad market signals: product type, audience, price band, common search language, and likely buyer questions.
2. Propose at least three differentiators: silhouette, accessory, color system, use case, or customization mechanism.
3. Select one concept and write a product brief with size, materials, skill level, and safety considerations.
4. Draft original pattern structure only when the user has supplied or approved the construction. Keep stitch counts internally consistent and recommend tester review.
5. Produce Etsy copy: title, description, tags, photo plan, FAQ, and digital-download disclosure.
6. Produce a launch checklist covering sample testing, original photography, file QA, versioning, and listing review.
7. Save the final brief in `docs/` when working in this repository. If a reusable assistant workflow is requested, update this skill rather than adding credentials or external integrations.

## Required output sections

- Product concept and assumptions
- Materials and finished size
- Original construction/pattern outline
- Etsy title and description
- Search tags
- Photo shot list
- Pricing test plan
- Customer FAQ
- IP/safety/quality checklist

## Reusable prompt

```text
Act as my Etsy crochet-product editor. Use only the original product brief below. Produce five Etsy titles under 140 characters, one buyer-friendly description, thirteen search tags, a materials list, a finished-size note, a safety note, a customer FAQ, and a photo shot list. Do not imitate or quote another seller’s listing. Flag claims that need verification.

Product brief: [paste brief]
```
