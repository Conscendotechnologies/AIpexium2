# VSIX Extensions Folder

This folder is intended to contain VSIX extension files that will be automatically installed on first startup and bundled with the application.

## Purpose
- Store custom or third-party VSIX extensions
- Extensions in this folder will be automatically installed when the IDE starts
- Extensions will also be included in the final application package
- Useful for distributing pre-installed extensions with your VS Code build

## Automatic Installation
- The IDE will automatically scan this folder for `.vsix` files on startup
- Extensions that are not already installed will be installed automatically
- Already installed extensions will be skipped to avoid duplicates
- You can disable this feature by setting `enableExtensionInstallationFromVsixFolder = false` in the extension management service

## Usage
1. Place your `.vsix` files in this directory
2. Start the IDE - extensions will be installed automatically
3. Run the build process: `npm run gulp -- vscode-win32-x64-min`
4. The extensions will be included in the final package under the `vsix/` directory

## Notes
- Only `.vsix` files should be placed here
- Large extensions may increase the final package size
- Extensions can be installed manually by users from this bundled location if automatic installation fails
- The automatic installation happens before GitHub release installations
