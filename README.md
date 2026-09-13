# DeepSeek Harness, Claude Code Skin

A fork of [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness) that reskins the multi chat canvas as resizable, reorderable editor panels laid out the way Claude Code lays its panels out, and fixes two defects found while running the harness day to day.

**This is not an official DeepSeek project, and it is not an Anthropic project.** DeepSeek Harness is developed by [DeepSeek AI](https://deepseek.com), and "DeepSeek Harness" is a registered trademark of DeepSeek. Claude Code is a product of Anthropic. This repository is an independent fork, is not endorsed by, affiliated with, or authorised by either company, and carries no official support from either. It is named for what it does, a reskin of one project in the visual style of another, and for no other reason. Everything here except the changes listed below is the work of the upstream authors, published under the same MIT licence. See [NOTICE.md](NOTICE.md).

## What this fork changes

Three changes to shipped source, plus one repository change.

### 1. The multi chat canvas, rebuilt as editor panels

`packages/client/ui-layout/src/client/MultiChatCanvas.tsx` and its stylesheet, with supporting changes in `AppFrame.tsx` and `index.ts`.

`packages/client/web/src/claude-code-theme.css`, loaded by `packages/client/web/src/boot.ts`, applies the matching flat dark palette throughout the web client.

Upstream lays the multi chat canvas out as separated tiles. This fork rebuilds it as flush editor panels:

- Panels sit flush against each other with no gutter, so the canvas reads as one surface rather than a set of cards.
- Each panel carries its own tab strip, so several conversations can live in one panel and be switched between without leaving the canvas.
- Panels can be dragged to resize, and dragged to reorder.
- The grid seeds six panels on first open, so a new canvas is populated rather than empty.

### 2. The model picker menu no longer gets clipped

`packages/client/ui-model-selection/src/client/ModelSelect.tsx`.

The menu is anchored to its trigger's right edge and grows leftwards. The composer that carries the trigger lives inside the conversation column, which clips its own horizontal overflow. Put that composer near the column's leading edge, as a narrow canvas panel or a collapsed sidebar does, and the menu's left side is cut off: measured at a 1920px window with the sidebar collapsed, the panel began 19px outside its clipping box, which is enough to eat the first character of every provider name in it.

The fix walks up to the nearest clipping ancestor, measures the untransformed box, and writes a `translateX` correction straight to the node. The correction is deliberately not held in React state: a state round trip re-runs the effect with a rect the previous pass moved, and subpixel disagreement between the two never settles, which is a maximum update depth crash that takes the whole model seat down.

### 3. An upstream config bug that silently emptied the model catalog

`packages/llm/llm-pi-ai/src/config.ts`.

`resolveProfiles` refused `openRouterProviderRouting` on any route other than `openrouter` by testing `!== undefined`. Schemastery materialises an absent dict as `{}`, so that guard fired for every route the moment the section carried more than the openrouter one. The whole namespace then fell back to the dormant empty route set, with no diagnostic: the model catalog simply came back empty and nothing said why.

The guard now tests emptiness rather than presence, so only a routing pin somebody actually typed is refused off the openrouter route.

### 4. Upstream CI is not included

The 19 GitHub Actions workflows and the Dependabot config that ship with upstream were removed in this fork. They are tuned to the upstream repository and its secrets, and would fail or burn Actions minutes on a fork. If you want CI here, add your own.

`.gitlab-ci.yml` is left in place as upstream shipped it. It does nothing on GitHub.

## What this fork does not change

Everything else. This is a whole copy of the upstream tree, not a plugin. In particular there are no model catalog additions in this repository: which models a given install can reach is a matter of local `settings.yaml` configuration, not repository code.

## Run

Node.js 22.19 or newer, and pnpm.

```sh
git clone https://github.com/Hieronymos2077/deepseek-harness-claude-code-skin.git
cd deepseek-harness-claude-code-skin
pnpm install
pnpm run build
pnpm dsh web
```

The web UI starts at `http://127.0.0.1:3080`. Pass `--no-open` to run the server without opening a browser.

For the upstream project's own documentation, see [README.upstream.md](README.upstream.md), the [development guide](docs/development.md), and the [architecture documentation](docs/architecture.md). Upstream's agent instructions are in [AGENTS.md](AGENTS.md).

## Relationship to upstream

Upstream states in [CONTRIBUTING.md](CONTRIBUTING.md) that it cannot accept external pull requests at this time, so these changes are published here rather than proposed upstream. If that position changes, the canvas work and the two fixes are the parts worth offering.

Bugs in the upstream project belong in [upstream's discussions](https://github.com/deepseek-ai/deepseek-harness/discussions), not here. Issues with the changes listed above belong here.

## Licence

[MIT](LICENSE), unchanged from upstream, including its copyright notice.

Third party dependencies and their licences are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Attribution for this fork is in [NOTICE.md](NOTICE.md).

Upstream's naming preferences are in [BRAND_GUIDELINES.md](BRAND_GUIDELINES.md), shipped here unaltered. They ask forks not to use the full "DeepSeek Harness" name and to prefer the short form `DSH`. This repository's name does not follow that preference, so it is stated plainly rather than glossed over: the name is descriptive, the disclaimer above is prominent, no DeepSeek or Anthropic brand assets are used, and if either company would rather this were named differently, say so on the issue tracker and it will be renamed.
