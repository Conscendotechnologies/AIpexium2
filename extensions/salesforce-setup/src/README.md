# Salesforce Setup — SIID Extension

Authorize Salesforce orgs and set up SFDX projects directly from your browser, with a single click.

---

## How It Works

1. The companion **Chrome extension** detects your active Salesforce session.
2. It fires a `siid://ConscendoTechInc.salesforce-setup/authorize` URI.
3. This SIID extension receives the URI and automatically:
   - Creates an SFDX project folder (if one doesn't exist)
   - Writes Salesforce CLI auth files for the org
   - Sets the org as the default for the project
   - Retrieves all metadata
   - Opens the project folder in SIID

No username or password entry needed — your browser session is used directly.

---

## Installation

### SIID Extension

1. Copy the `salesforce-setup` folder into your SIID extensions directory:
   - **Windows**: `%USERPROFILE%\.siid\extensions\`
   - **Mac / Linux**: `~/.siid/extensions/`

2. Reload SIID:
   `Ctrl+Shift+P` → **Developer: Reload Window**

3. Verify:
   `Ctrl+Shift+P` → type **SF Setup** — you should see the commands listed.

### Chrome Extension

1. Open **chrome://extensions** and enable **Developer mode**.
2. Click **Load unpacked** and select the `chrome-extension` folder.
3. Navigate to any Salesforce page — the SIID icon appears in the toolbar.

---

## Requirements

- **Salesforce CLI** (`sf`) must be installed and on your PATH:
  ```bash
  npm install -g @salesforce/cli
  ```
- **SIID** 1.74.0 or higher

---

## Extension Settings

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `salesforce-setup.projectsDirectory` | string | `""` | Root directory for Salesforce projects. Leave empty to use `~/salesforce-projects`. |
| `salesforce-setup.autoRetrieveMetadata` | boolean | `true` | Retrieve all metadata after authorization. |
| `salesforce-setup.enableDebugLogging` | boolean | `false` | Verbose logging in the output channel. |

---

## URI Format

```
siid://ConscendoTechInc.salesforce-setup/authorize
  ?instanceUrl=https://myorg.my.salesforce.com
  &accessToken=<session-id>
  &alias=myorg
  &projectName=myorg
  &retrieve=true
```

| Parameter | Description |
|-----------|-------------|
| `instanceUrl` | Salesforce instance URL (already normalised by Chrome extension) |
| `accessToken` | Session token read from the `sid` browser cookie |
| `alias` | Org alias used by the Salesforce CLI |
| `projectName` | Sanitized folder name for the project |
| `retrieve` | `"true"` to retrieve metadata after auth, `"false"` to skip |

---

## Commands

All commands are available via `Ctrl+Shift+P` with the `SF Setup` prefix:

| Command | Description |
|---------|-------------|
| `SF Setup: Authorize Org from Browser` | Shows a message pointing to the Chrome extension |
| `SF Setup: Show Connection Status` | Prints current config to the output channel |
| `SF Setup: Open Salesforce Project Folder` | Opens the configured projects directory |
| `SF Setup: Retrieve Metadata from Org` | Prompts for an alias and retrieves metadata |
| `SF Setup: Set Projects Directory` | Opens a folder picker to set the projects root |

---

## Output Channel

View detailed logs for every authorization attempt:

1. **View** → **Output**
2. Select **Salesforce Setup** from the dropdown

---

## Troubleshooting

### `sf: command not found`
Salesforce CLI is not on your PATH. Install it:
```bash
npm install -g @salesforce/cli
```
Then restart SIID.

### Missing `instanceUrl` or `accessToken`
- Make sure you are logged into Salesforce in the browser.
- Refresh the Salesforce page and try again.
- Check that the Chrome extension has permission to read cookies (`chrome://extensions` → Details → Site access).

### Project creation fails
Open the **Salesforce Setup** output channel for the exact error. Common causes:
- Salesforce CLI not in PATH
- Invalid or expired session token
- Network or firewall blocking `salesforce.com`

---

## Release Notes

### 1.0.0

Initial release:
- `siid://` URI handler for the Salesforce Setup Chrome extension
- Automatic org authorization via auth file injection
- SFDX project creation and configuration
- Metadata retrieval (common types)
- Activity bar view with quick-access commands
- Status bar indicator
- Full output channel logging
