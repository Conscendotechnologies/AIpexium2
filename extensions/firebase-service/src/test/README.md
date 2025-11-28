# Firebase Service API Tests

This directory contains comprehensive test suites for the Firebase Service API.

## Test Files

### 1. `apiTest.ts` - Full Test Suite
Comprehensive test suite that tests all API methods with detailed logging and verification.

**Features:**
- Tests all authentication methods (signIn, signOut, isAuthenticated, etc.)
- Tests user information methods (getCurrentUser, getAuthPageUrl, etc.)
- Tests Firestore methods (getUserProperties, getAdminApiKey, updateUserProperties)
- Tests event handlers (onAuthStateChanged)
- Tests error handling and edge cases
- Provides detailed test results with pass/fail metrics
- Shows execution time for each test
- Outputs results to a dedicated output channel

**How to Run:**
1. Open Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Type: `FBS Debug: Run API Tests (Full Suite)`
3. Choose whether to include sign-out test
4. Watch the output channel for detailed results

**What it Tests:**
- ✅ Authentication status checking (before and after sign-in)
- ✅ Sign-in functionality (optional, interactive)
- ✅ User data retrieval
- ✅ Session refresh
- ✅ Auth page URL retrieval
- ✅ Firebase manager access
- ✅ Firestore user properties (read all, read specific)
- ✅ Admin API key retrieval
- ✅ Update user properties (single field, multiple fields)
- ✅ Rapid concurrent authentication checks
- ✅ Error handling with invalid data
- ✅ Event listener functionality
- ✅ Sign-out functionality (optional)

### 2. `simpleTest.ts` - Quick Test Suite
Lightweight test that quickly validates all API methods are accessible and working.

**Features:**
- Fast execution (< 5 seconds)
- Non-destructive (doesn't modify data unless requested)
- Simple pass/fail output
- Tests read-only methods by default
- Can test individual methods

**How to Run:**

**Option A: Quick Test (All Methods)**
1. Open Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Type: `FBS Debug: Quick API Test`
3. View results in output channel

**Option B: Test Specific Method**
1. Open Command Palette (Ctrl+Shift+P / Cmd+Shift+P)
2. Type: `FBS Debug: Test Specific API Method`
3. Select the method you want to test
4. View results in output channel

**Available Methods:**
- `isAuthenticated` - Check authentication status
- `getCurrentUser` - Get current user info
- `getUserProperties` - Get user properties from Firestore
- `getAdminApiKey` - Get admin API key
- `getAuthPageUrl` - Get authentication page URL
- `getFirebaseManager` - Get Firebase manager instance

## Test Results

Both test suites output to VS Code output channels:
- Full Suite: "Firebase API Tests"
- Quick Test: "Firebase Quick Test"
- Method Test: "Firebase Method Test"

### Understanding Test Results

**Full Test Suite Output:**
```
========================================
Firebase Service API Test Suite
========================================

=== Testing Authentication Methods ===

▶️  isAuthenticated (Initial Check)...
✅ isAuthenticated (Initial Check): Authentication status: true (45ms)

... (more tests)

========================================
Test Summary
========================================

Total Tests: 15
✅ Passed: 15
❌ Failed: 0
📊 Pass Rate: 100.0%
⏱️  Total Duration: 2340ms
⏱️  Average Duration: 156.0ms

========================================
```

**Quick Test Output:**
```
=== Firebase API Quick Test ===

✅ Extension found
✅ Extension activated

▶️  Test 1: Check Authentication Status
   Result: ✅ Authenticated

▶️  Test 2: Get Current User
   ✅ User: user@example.com
   UID: abc123xyz

... (more tests)

=== Test Complete ===
Authentication: ✅ Yes
User Available: ✅ Yes
Firebase Manager: ✅ Yes
```

## When to Use Each Test

### Use Full Test Suite When:
- Implementing new features
- Debugging complex issues
- Verifying all functionality after changes
- Need detailed performance metrics
- Want to test write operations (updates)
- Preparing for release

### Use Quick Test When:
- Quick sanity check
- Verifying extension is working
- Testing after installation
- Checking specific method behavior
- Don't want to modify any data
- Need fast feedback

## Requirements

- Firebase Service extension must be installed
- Extension must be activated (happens automatically)
- For authenticated tests: User must be signed in
- For Firestore tests: Firestore must be configured

## Troubleshooting

### "Firebase Service extension not found"
- Ensure the extension is installed
- Check the extension ID matches: `ConscendoTechInc.firebase-service`

### "User not authenticated" warnings
- Sign in first using: `FBS: Sign In`
- Some tests require authentication and will be skipped if not signed in

### "Firebase services not initialized"
- Run: `FBS: Initialize Firebase Service`
- Check Firebase configuration settings

### Tests timing out
- Check network connection
- Verify Firebase project is accessible
- Check Firebase configuration in settings

## Adding New Tests

To add new tests to the full test suite:

1. Open `apiTest.ts`
2. Add a new test method in the appropriate category
3. Use the `runTest()` helper method:

```typescript
await this.runTest('Test Name', async () => {
    // Your test code here
    const result = await api.someMethod();

    if (result) {
        return { success: true, message: 'Test passed' };
    } else {
        return { success: false, message: 'Test failed' };
    }
});
```

## API Coverage

All public API methods from `api.ts` are tested:

**Authentication (7 methods):**
- [x] signIn
- [x] signOut
- [x] getCurrentUser
- [x] isAuthenticated
- [x] showAuthStatus
- [x] refreshSession
- [x] onAuthStateChanged

**Firestore (3 methods):**
- [x] getUserProperties
- [x] getAdminApiKey
- [x] updateUserProperties

**Utilities (2 methods):**
- [x] getFirebaseManager
- [x] getAuthPageUrl

**Total: 12/12 methods tested (100% coverage)**
