# Notice

## Origin

This repository is a fork of [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness), an open source agent harness developed by DeepSeek AI and licensed under the MIT licence.

The overwhelming majority of the code, documentation and vendored dependencies here is the work of the upstream authors. It is redistributed under the MIT licence, with upstream's copyright notice preserved verbatim in [LICENSE](LICENSE):

> Copyright (c) 2026 DeepSeek

That notice is not replaced, and is not to be replaced. The MIT licence requires it to be included in all copies or substantial portions of the software, and it is.

## Modifications

Copyright (c) 2026 Hieronymos, for the modifications described below only.

The modifications are also released under the MIT licence, so the repository as a whole remains MIT.

Changed files, and nothing else:

| File | Change |
|---|---|
| `packages/client/ui-layout/src/client/MultiChatCanvas.tsx` | Multi chat canvas rebuilt as flush editor panels with per panel tab strips, drag to resize and drag to reorder |
| `packages/client/ui-layout/src/client/MultiChatCanvas.module.css` | Styling for the above |
| `packages/client/ui-layout/src/client/AppFrame.tsx` | Supporting changes for the above |
| `packages/client/ui-layout/src/client/AppFrame.module.css` | Supporting changes for the above |
| `packages/client/ui-layout/src/client/index.ts` | Exports for the above |
| `packages/client/web/src/claude-code-theme.css` | Flat dark palette applied throughout the web client |
| `packages/client/web/src/boot.ts` | Imports the fork's web client theme |
| `packages/client/ui-model-selection/src/client/ModelSelect.tsx` | Clamp the open model menu inside its nearest clipping ancestor |
| `packages/llm/llm-pi-ai/src/config.ts` | Fix an `openRouterProviderRouting` guard that silently emptied the model catalog |

Repository level changes:

- The 19 upstream GitHub Actions workflows and the Dependabot configuration were removed. They are tuned to the upstream repository and its secrets.
- `README.md` was replaced with a README describing this fork. Upstream's original English README is preserved verbatim as `README.upstream.md`.
- `README.zh.md` is upstream's, verbatim, except that its "English" link was repointed from `README.md` to `README.upstream.md` so the bilingual pair still resolves.
- `README.i18n.yaml`, upstream's machine readable consistency record for the `README.md` and `README.zh.md` pair, was removed, because this fork does not maintain that pair.
- This `NOTICE.md` was added.

Every other file in this repository is upstream's, unmodified.

## Trademark

"DeepSeek Harness" is a registered trademark of DeepSeek. "Claude Code" is a product of Anthropic. This project is affiliated with neither company.

Upstream's [brand asset usage guidelines](BRAND_GUIDELINES.md) are shipped here unaltered. They ask projects to avoid using the full "DeepSeek Harness" name directly and to prefer the abbreviated `DSH` designation instead. This repository is named "DeepSeek Harness, Claude Code Skin", which does not follow that preference. That is recorded here rather than glossed over, along with what is done instead:

- The name is descriptive of what the repository is, a fork of one project reskinned in the visual style of another. It is not chosen to suggest a relationship that does not exist.
- The relationship to upstream is described truthfully as a fork, at the top of the README and here. Nothing in this repository claims endorsement, cooperation, authorisation or affiliation by DeepSeek or by Anthropic.
- No DeepSeek or Anthropic brand materials, logos, or official assets are used in this repository or its presentation.
- If DeepSeek or Anthropic would prefer a different name, opening an issue is enough. It will be renamed, and GitHub preserves redirects from the old name.

## Third party dependencies

Dependencies and their licences are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), preserved from upstream. Vendored sources under `vendor/` carry their own `LICENSE` files, also preserved.
