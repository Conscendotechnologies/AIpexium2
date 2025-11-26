# Firebase Service API Testing Guide

This guide explains how to test all the Firebase Service API functionality.

## 🎯 Quick Start

### Option 1: Quick Test (Recommended for First-Time Testing)
1. Open VS Code Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
2. Type: **`FBS Debug: Quick API Test`**
3. Press Enter
4. View results in the "Firebase Quick Test" output channel

**Time:** ~5 seconds | **Destructive:** No

### Option 2: Full Test Suite (Comprehensive Testing)
1. Open VS Code Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
2. Type: **`FBS Debug: Run API Tests (Full Suite)`**
3. Select test mode:
   - **Run All Tests (Exclude Sign Out)** - Tests everything except sign-out
   - **Run All Tests + Sign Out** - Tests everything including sign-out (will sign you out!)
4. Follow interactive prompts for write operations
5. View detailed results in the "Firebase API Tests" output channel

**Time:** ~30-60 seconds | **Destructive:** Optional

### Option 3: Test Individual Methods
1. Open VS Code Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`)
2. Type: **`FBS Debug: Test Specific API Method`**
3. Select the method you want to test
4. View results in the "Firebase Method Test" output channel

**Time:** < 1 second per method | **Destructive:** No

## 📋 What Gets Tested

### Authentication Methods (7)
- ✅ `signIn()` - User sign-in with OAuth providers
- ✅ `signOut()` - User sign-out
- ✅ `getCurrentUser()` - Get current user session
- ✅ `isAuthenticated()` - Check authentication status
- ✅ `showAuthStatus()` - Display auth status to user
- ✅ `refreshSession()` - Refresh authentication session
- ✅ `onAuthStateChanged` - Event listener for auth changes

### Firestore Methods (3)
- ✅ `getUserProperties()` - Get user data from Firestore
  - All properties
  - Specific properties
- ✅ `getAdminApiKey()` - Get admin API key
- ✅ `updateUserProperties()` - Update user data in Firestore
  - Single field update
  - Multiple field update

### Utility Methods (2)
- ✅ `getFirebaseManager()` - Get Firebase manager instance
- ✅ `getAuthPageUrl()` - Get authentication page URL

**Total: 12/12 methods (100% coverage)**

## 📊 Understanding Test Results

### Quick Test Output Example
```
=== Firebase API Quick Test ===

✅ Extension found
✅ Extension activated

▶️  Test 1: Check Authentication Status
   Result: ✅ Authenticated

▶️  Test 2: Get Current User
   ✅ User: user@example.com
   UID: abc123xyz789
   Name: John Doe

▶️  Test 3: Get Auth Page URL
   ✅ URL: https://your-auth-page.web.app/auth

▶️  Test 4: Get Firebase Manager
   ✅ Manager available

▶️  Test 5: Get User Properties (All)
   ✅ Retrieved 5 properties
   Properties: email, displayName, createdAt, lastLogin, preferences

=== Test Complete ===
Authentication: ✅ Yes
User Available: ✅ Yes
Firebase Manager: ✅ Yes
```

### Full Test Suite Output Example
```
========================================
Firebase Service API Test Suite
========================================

=== Testing Authentication Methods ===

▶️  isAuthenticated (Initial Check)...
✅ isAuthenticated (Initial Check): Authentication status: true (23ms)

▶️  showAuthStatus...
✅ showAuthStatus: Auth status displayed successfully (156ms)

▶️  getCurrentUser (Post-Auth)...
  UID: abc123xyz789
  Email: user@example.com
  Display Name: John Doe
✅ getCurrentUser (Post-Auth): User data retrieved successfully (45ms)

=== Testing Firestore Methods ===

▶️  getUserProperties (All)...
  User properties: {
    "email": "user@example.com",
    "displayName": "John Doe",
    "createdAt": "2025-01-15T10:30:00Z"
  }
✅ getUserProperties (All): Retrieved 3 properties (234ms)

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

## 🔍 Test Details

### Pre-Authentication Tests
These tests run **before** sign-in (or when not signed in):
- Check initial authentication status
- Verify no user data is returned when not authenticated
- Test auth page URL retrieval

### Post-Authentication Tests
These tests require authentication:
- Verify user is authenticated
- Retrieve and validate user data
- Test session refresh
- Access Firestore user properties
- Test event listeners

### Firestore Tests
These tests interact with Firebase Firestore:
- Read user properties (all fields)
- Read specific user properties
- Retrieve admin API key
- Update single user property (optional, interactive)
- Update multiple user properties (optional, interactive)

### Interactive Tests
Some tests ask for user confirmation before running:
- **Sign-in test**: Prompts before initiating sign-in flow
- **Update tests**: Asks before modifying Firestore data
- **Sign-out test**: Confirms before signing out

## ⚠️ Important Notes

### Before Running Tests

1. **Ensure Extension is Installed**
   - Extension ID: `ConscendoTechInc.firebase-service`
   - Check: Extensions panel → Search "Firebase Service"

2. **Configure Firebase Settings**
   - Open Settings → Search "Firebase Service"
   - Required: API Key, Auth Domain, Project ID
   - Optional: Storage Bucket, App ID, etc.

3. **Sign In (for authenticated tests)**
   - Command: `FBS: Sign In`
   - Or let the test suite prompt you

### During Testing

- **Don't interrupt**: Let tests complete fully
- **Check output**: All results go to output channels
- **Interactive prompts**: Some tests ask for confirmation
- **Network required**: Tests need internet connection

### After Testing

- **Review results**: Check output channel for details
- **Check Firestore**: Verify test data if updates were made
- **Clean up**: Test fields (`testField`, `testField1`, etc.) can be deleted

## 🐛 Troubleshooting

### "Firebase Service extension not found"
**Solution:** Install the extension or check the extension ID

### "User not authenticated" warnings
**Solution:** Run `FBS: Sign In` before testing

### "Firebase services not initialized"
**Solution:** Run `FBS: Initialize Firebase Service`

### Tests timing out
**Solutions:**
- Check internet connection
- Verify Firebase project is accessible
- Check Firebase configuration in settings
- Ensure Firestore security rules allow access

### Compilation errors
**Solution:** Run `npm run compile` in the extension directory

### "No user data found in Firestore"
**Solution:** Ensure Firestore is enabled and user document exists at `users/{uid}`

## 📁 Test Files

All test files are located in `src/test/`:

- **`apiTest.ts`** - Full comprehensive test suite
- **`simpleTest.ts`** - Quick lightweight tests
- **`README.md`** - Detailed test documentation

## 🚀 Advanced Usage

### Running Tests Programmatically

You can call the test functions from other extensions:

```typescript
import * as vscode from 'vscode';

// Get the Firebase Service extension
const firebaseExt = vscode.extensions.getExtension('ConscendoTechInc.firebase-service');
const api = await firebaseExt.activate();

// Now use the API
const isAuth = await api.isAuthenticated();
const user = await api.getCurrentUser();
```

### Adding Custom Tests

1. Open `src/test/apiTest.ts`
2. Add your test in the appropriate section
3. Use the `runTest()` helper:

```typescript
await this.runTest('My Custom Test', async () => {
    const result = await this.api.someMethod();
    if (result) {
        return { success: true, message: 'Test passed' };
    } else {
        return { success: false, message: 'Test failed' };
    }
});
```

## 📝 Test Checklist

Use this checklist when testing:

- [ ] Extension is installed and activated
- [ ] Firebase configuration is complete
- [ ] User is signed in (for authenticated tests)
- [ ] Internet connection is available
- [ ] Firestore is enabled in Firebase project
- [ ] Run Quick Test first
- [ ] Run Full Test Suite
- [ ] Review all test results
- [ ] Check Firestore for test data
- [ ] Clean up test data if needed

## 🎓 Best Practices

1. **Test after changes**: Run tests after modifying API code
2. **Start with Quick Test**: Use Quick Test for rapid feedback
3. **Full Suite for releases**: Run Full Suite before releases
4. **Document failures**: Note any test failures with context
5. **Clean test data**: Remove test properties from Firestore
6. **Monitor performance**: Check test execution times
7. **Test incrementally**: Use individual method tests during development

## 📞 Support

If tests fail consistently:
1. Check Firebase Console for errors
2. Verify extension configuration
3. Review output channel logs
4. Check network connectivity
5. Ensure Firestore security rules are correct

---

**Happy Testing! 🧪**
