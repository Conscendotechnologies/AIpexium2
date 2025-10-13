# VS Code Build Pipeline Guide

## Complete Build Sequence
```bash
npm install                                    # Install dependencies
npm run gulp compile-build-without-mangling    # Compile TypeScript source
npm run gulp bundle-vscode                     # Bundle the application
npm run gulp -- vscode-win32-x64-min          # Package for Windows x64
npm run gulp -- vscode-win32-x64-inno-updater # Create tools directory
npm run gulp -- vscode-win32-x64-system-setup # Create system installer
npm run gulp -- vscode-win32-x64-user-setup   # Create user installer
```

## What Each Command Does

| Command | Purpose | Output |
|---------|---------|---------|
| `npm install` | Install Node.js dependencies | `node_modules/` |
| `compile-build-without-mangling` | Compile TypeScript to JavaScript | `out/` directory |
| `bundle-vscode` | Bundle app into optimized files | `out-vscode/` |
| `vscode-win32-x64-min` | Package complete Windows app | `../VSCode-win32-x64/` |
| `vscode-win32-x64-inno-updater` | Create tools for installer | `../VSCode-win32-x64/tools/` |
| `vscode-win32-x64-system-setup` | Create system-wide installer | `.build/win32-x64/system-setup/` |
| `vscode-win32-x64-user-setup` | Create user-only installer | `.build/win32-x64/user-setup/` |

## Where to Restart Based on Changes

### 🔧 Source Code Changes (TypeScript/JavaScript)
**Files**: `src/**/*.ts`, `src/**/*.js`
**Restart from**: `npm run gulp compile-build-without-mangling`
```bash
npm run gulp compile-build-without-mangling
npm run gulp bundle-vscode
npm run gulp -- vscode-win32-x64-min
npm run gulp -- vscode-win32-x64-inno-updater
npm run gulp -- vscode-win32-x64-system-setup
```

### 🎨 UI/CSS Changes
**Files**: `src/**/*.css`, `src/**/*.scss`
**Restart from**: `npm run gulp compile-build-without-mangling`
```bash
npm run gulp compile-build-without-mangling
npm run gulp bundle-vscode
npm run gulp -- vscode-win32-x64-min
npm run gulp -- vscode-win32-x64-inno-updater
npm run gulp -- vscode-win32-x64-system-setup
```

### 📦 Extension Changes
**Files**: `extensions/**/*`
**Restart from**: `npm run gulp bundle-vscode`
```bash
npm run gulp bundle-vscode
npm run gulp -- vscode-win32-x64-min
npm run gulp -- vscode-win32-x64-inno-updater
npm run gulp -- vscode-win32-x64-system-setup
```

### 🏷️ Product Branding Changes
**Files**: `product.json`, `package.json`
**Restart from**: `npm run gulp -- vscode-win32-x64-min`
```bash
npm run gulp -- vscode-win32-x64-min
npm run gulp -- vscode-win32-x64-inno-updater
npm run gulp -- vscode-win32-x64-system-setup
```

### 🖼️ Resource Changes (Icons, Images)
**Files**: `resources/**/*`
**Restart from**: `npm run gulp -- vscode-win32-x64-min`
```bash
npm run gulp -- vscode-win32-x64-min
npm run gulp -- vscode-win32-x64-inno-updater
npm run gulp -- vscode-win32-x64-system-setup
```

### 📋 Installer Configuration Changes
**Files**: `build/win32/code.iss`, installer scripts
**Restart from**: `npm run gulp -- vscode-win32-x64-system-setup`
```bash
npm run gulp -- vscode-win32-x64-system-setup
```

### 📦 Dependencies Changes
**Files**: `package.json` (dependencies section)
**Restart from**: `npm install`
```bash
npm install
npm run gulp compile-build-without-mangling
npm run gulp bundle-vscode
npm run gulp -- vscode-win32-x64-min
npm run gulp -- vscode-win32-x64-inno-updater
npm run gulp -- vscode-win32-x64-system-setup
```

## Quick Development Tips

### For Faster Development Iterations
- Use `npm run watch` during development for auto-compilation
- Only run the full sequence when you need to test the complete application
- For quick testing, you can run the app directly from `../VSCode-win32-x64/Code - OSS.exe`

### Clean Build (when things go wrong)
```bash
npm run clean
# Then run the full sequence
```

### Testing Without Installer
After `vscode-win32-x64-min`, you can test your changes by running:
```bash
# Navigate to the built app
cd ../VSCode-win32-x64
# Run the executable directly
"Code - OSS.exe"
```
