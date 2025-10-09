# Roo Code - Built-in AI Coding Assistant

Roo Code is a powerful AI-powered autonomous coding agent built directly into VSCode. It provides intelligent code generation, architecture design, debugging assistance, and more.

## Features

### 🤖 Multiple Operation Modes

1. **Code Mode** - AI-powered code generation and editing
   - Generate new code from natural language descriptions
   - Modify existing code with intelligent refactoring
   - Support for multiple programming languages

2. **Architect Mode** - System architecture and design
   - Design scalable software architectures
   - Create system diagrams and documentation
   - Evaluate architectural decisions

3. **Ask Mode** - Technical Q&A and documentation
   - Get answers to technical questions
   - Generate documentation
   - Explain complex code concepts

4. **Debug Mode** - Bug finding and fixing assistance
   - Analyze error messages and stack traces
   - Suggest fixes for bugs
   - Explain why bugs occur

5. **Custom Mode** - Flexible user-defined workflows
   - Create custom AI-powered workflows
   - Chain multiple operations together
   - Automate repetitive tasks

### 🔧 Core Capabilities

- **File System Integration**: Direct access to workspace files with read/write operations
- **Terminal Integration**: Execute commands and scripts directly from Roo Code
- **MCP Support**: Model Context Protocol for advanced integrations
- **Multi-Model Support**: Choose from GPT-4, GPT-3.5, Claude 3 Opus, Claude 3 Sonnet
- **Session Management**: Save and restore coding sessions
- **Configuration**: Extensive settings for customization

## Getting Started

### Configuration

Configure Roo Code through VSCode settings:

```json
{
  "roocode.apiKey": "your-api-key-here",
  "roocode.model": "gpt-4",
  "roocode.mode": "code",
  "roocode.autoSave": true,
  "roocode.maxTokens": 4096,
  "roocode.enabled": true
}
```

### Starting a Session

1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run: `Roo Code: Start Session`
3. Roo Code panel will open and you can start interacting

### Using Different Modes

Change mode in settings or through the UI:
- Code Mode: For generating and editing code
- Architect Mode: For designing systems
- Ask Mode: For questions and documentation
- Debug Mode: For fixing bugs
- Custom Mode: For custom workflows

## Commands

Available commands in Command Palette:

- `Roo Code: Start Session` - Start a new Roo Code session
- `Roo Code: Stop Session` - Stop the current session
- `Roo Code: Get Session Status` - Check session status
- `Roo Code: Execute Command` - Execute a custom command

## Architecture

### Service Layer

- **RoocodeService**: Main service coordinating all functionality
- **RoocodeAIService**: Handles AI provider communication
- **RoocodeFileSystemService**: Manages file operations
- **RoocodeTerminalService**: Controls terminal execution
- **RoocodeMCPService**: MCP protocol implementation

### Mode Handlers

Each operation mode has a dedicated handler:
- `RoocodeCodeModeHandler`
- `RoocodeArchitectModeHandler`
- `RoocodeAskModeHandler`
- `RoocodeDebugModeHandler`
- `RoocodeCustomModeHandler`

## Integration Points

### Workbench Integration

Roo Code is integrated as a workbench contribution at:
```
src/vs/workbench/contrib/roocode/
├── browser/          # UI and service implementations
├── common/           # Shared types and interfaces
└── node/             # Node.js backend services
```

### Configuration Schema

Settings are registered in VSCode's configuration system with full validation and type safety.

### Command System

All commands are registered with VSCode's command system and available through the Command Palette.

## Development

### Building

Roo Code is compiled as part of the VSCode build process:

```bash
npm run compile
```

### Testing

Tests can be added to:
```
src/vs/workbench/contrib/roocode/test/
```

## API Reference

### IRoocodeService

Main service interface:

```typescript
interface IRoocodeService {
  startSession(): Promise<void>;
  stopSession(): Promise<void>;
  executeCommand(command: string, args?: any[]): Promise<any>;
  getSessionStatus(): RoocodeSessionStatus;
}
```

### Mode Handlers

Each mode handler implements:

```typescript
abstract class RoocodeModeHandler {
  abstract handleRequest(input: string, context?: any): Promise<any>;
}
```

## Security

- API keys are stored securely in VSCode settings
- File operations are limited to workspace scope
- Terminal commands require user confirmation for sensitive operations
- All AI requests are logged for audit purposes

## Privacy

- Code sent to AI providers is controlled by user
- Session data is stored locally
- No telemetry without user consent

## Support

For issues and feature requests, please use the GitHub repository issue tracker.

## License

Licensed under MIT License. See LICENSE.txt for details.

## Contributing

Contributions are welcome! Please follow VSCode's contribution guidelines.

## Credits

Based on the Pro-Code (Roo Code) extension, now integrated as a built-in VSCode feature for better performance and integration.
