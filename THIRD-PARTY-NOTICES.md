# Third-party notices

PR Cascade is MIT-licensed (see [LICENSE](LICENSE)). The `.vsix` it ships also contains the
material below, which is not ours and is not covered by that licence. (The npm packages esbuild
bundles into `dist/extension.js` would be listed here too; today there are none — every PR's
"Dependencies & bundle" section and plan §11.3 say why.)

## Codicons — `@vscode/codicons` 0.0.46-24 (Microsoft)

`dist/webview/codicon.ttf` and `dist/webview/codicon.css` are copied unchanged from the npm package
`@vscode/codicons`, Microsoft's [vscode-codicons](https://github.com/microsoft/vscode-codicons),
when the extension is built (`esbuild.mjs`). The views draw their icons with them.

- **The icons** (the font, `codicon.ttf`) — Copyright (c) Microsoft Corporation. Licensed under the
  Creative Commons Attribution 4.0 International licence (CC BY 4.0),
  <https://creativecommons.org/licenses/by/4.0/> — the package's `LICENSE` file. No changes were
  made to them. They are provided as-is: the licence's section 5 disclaims all warranties.
- **The code** (the stylesheet, `codicon.css`) — Copyright (c) Microsoft Corporation. Licensed under
  the MIT License — the package's `LICENSE-CODE` file, reproduced below; the copied stylesheet keeps
  its own header.

```
MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE
```

Neither licence grants rights to Microsoft's names, logos or trademarks.
