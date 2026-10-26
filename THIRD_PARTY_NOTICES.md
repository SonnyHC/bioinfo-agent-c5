# Third-party references and dependencies

## DeepSeek Harness

- Source: https://github.com/deepseek-ai/deepseek-harness
- Installed package: `@deepseek-ai/dsh`, pinned to `0.2.1-rc.2` to match the inspected BioDSH preview integration target.
- License: MIT. The installed distribution retains upstream license and third-party notices. No claim of affiliation or endorsement is made.
- This repository adds a separate plugin bundle through the published extension interface. The upstream framework is not vendored or modified.

## BioDSH

- Source: https://github.com/sagirimo/BioDSH/releases/tag/desktop-tauri-v1.0.0-preview.1
- Inspected release commit: `7a1618c` (full source identified during implementation).
- License: MIT, Copyright (c) 2026 Zhan Pengyu.
- Reference scope: domain assistant workflow and bundle/preset integration pattern. The application, analysis engine and C5 tools are independently implemented. No BioDSH installer, logo, screenshot or community skill collection is distributed.

## Runtime dependencies

JavaScript dependencies and resolved versions are recorded in `package-lock.json`. Python analysis dependencies and fixed versions are recorded in `python/requirements.txt`. Licenses remain in the respective installed distributions; do not remove those notices when distributing packaged software. A packaged desktop release will need its own dependency and license inventory before distribution.

The competition notice and supplied task list inform the scope. The user's supplied archive and internal planning text are not included in the repository.
