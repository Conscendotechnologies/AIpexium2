# VSIX Extensions Folder

This folder is intended to contain VSIX extension files that will be bundled with the application.

## Purpose
- Store custom or third-party VSIX extensions
- Extensions in this folder will be included in the final application package
- Useful for distributing pre-installed extensions with your VS Code build

## Usage
1. Place your `.vsix` files in this directory
2. Run the build process: `npm run gulp -- vscode-win32-x64-min`
3. The extensions will be included in the final package under the `vsix/` directory

## Notes
- Only `.vsix` files should be placed here
- Large extensions may increase the final package size
- Extensions can be installed manually by users from this bundled location
