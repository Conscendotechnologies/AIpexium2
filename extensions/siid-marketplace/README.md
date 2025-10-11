# Siid Marketplace Extension

A built-in marketplace extension for Siid IDE that displays custom extensions built and maintained by Conscendo Technologies.

## Features

- **Custom Extension Discovery**: Browse extensions specifically designed for Siid IDE
- **GitHub Integration**: Automatic fetching of extension metadata from GitHub repositories
- **Categorized View**: Extensions organized by categories (AI Tools, Salesforce, Development Tools, Themes)
- **Installation Management**: Install, uninstall, and update extensions
- **Status Tracking**: Visual indicators for installed, updatable, and required extensions
- **Extension Details**: Comprehensive information about each extension including descriptions, tags, and links

## Extension Categories

- **AI Tools**: Intelligent coding assistants and AI-powered development tools
- **Salesforce**: Complete Salesforce development toolkit including Apex, LWC, and CLI integration
- **Development Tools**: Enhanced Git integration, snippet management, and productivity tools
- **Themes**: Professional themes optimized for Siid IDE

## How It Works

The marketplace extension:

1. Reads configuration from `product.json` under the `customExtensions` section
2. Fetches latest release information from configured GitHub repositories
3. Displays extensions in a tree view organized by categories
4. Provides context menu actions for extension management
5. Integrates with the existing custom extension installer system

## Configuration

Extensions are configured in the `product.json` file:

```json
{
  "customExtensions": {
    "githubReleases": [
      {
        "owner": "owner-name",
        "repo": "repo-name",
        "extensionId": "publisher.extension-id",
        "vsixAssetName": "extension-*.vsix",
        "displayName": "Extension Display Name",
        "description": "Extension description",
        "category": "Category Name",
        "required": true,
        "tags": ["tag1", "tag2"]
      }
    ],
    "marketplace": {
      "enabled": true,
      "showInExplorer": true,
      "categories": ["AI Tools", "Salesforce", "Development Tools", "Themes"]
    }
  }
}
```

## Commands

- `siidMarketplace.refresh`: Refresh the extension list
- `siidMarketplace.install`: Install selected extension
- `siidMarketplace.uninstall`: Uninstall selected extension
- `siidMarketplace.update`: Update selected extension
- `siidMarketplace.viewOnGitHub`: Open extension's GitHub repository
- `siidMarketplace.viewDetails`: View detailed extension information
- `siidMarketplace.checkUpdates`: Check for available updates

## Development

This extension is built using:
- TypeScript for type safety
- VS Code Extension API for integration
- GitHub API for fetching metadata
- Custom CSS for styling

The extension integrates with the existing custom extension management system in Siid IDE for actual installation and management of extensions.

## License

This extension is part of the Siid IDE and follows the same licensing terms.