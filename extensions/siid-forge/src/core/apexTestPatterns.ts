/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Apex test-pattern analyzer (plan §18.D) — the Apex analogue of LWC's
 * `analyzeMocks`. Apex has no Jest mocks; the equivalents are the **test-data +
 * isolation patterns** a generated test MUST get right (they are the source of
 * most real Apex test failures): a `@TestSetup`/factory for required fields,
 * `Test.startTest()/stopTest()` boundaries, `Test.setMock` for callouts,
 * `System.runAs` for permission checks, and the right async harness.
 *
 * Pure + headless (§14): takes the class source (+ optional touched-object names)
 * and returns detected patterns with ready-to-paste guidance. Injected into the
 * 18.B scaffold and the 18.C prompt, exactly as `analyzeMocks` was for LWC.
 */

export type ApexTestPatternKind =
  | 'testSetup'      // required-field factory / @TestSetup
  | 'startStopTest'  // Test.startTest()/stopTest() boundary
  | 'httpMock'       // Test.setMock(HttpCalloutMock)
  | 'wsMock'         // Test.setMock(WebServiceMock)
  | 'runAs'          // System.runAs for CRUD/FLS/UserInfo
  | 'asyncFuture'    // @future
  | 'asyncQueueable' // Queueable
  | 'asyncBatch'     // Database.Batchable
  | 'asyncSchedule'  // Schedulable
  | 'exceptionPath'  // throws — needs a negative test
  | 'singleRowQuery' // [SELECT … LIMIT 1] assigned to an sObject — throws on no rows
  | 'runAsVisibility'// runAs + sharing can hide @TestSetup data
  | 'noSeeAllData';  // reminder: never seeAllData=true

export interface ApexTestPattern {
  kind: ApexTestPatternKind;
  /** Short human/AI-facing title. */
  title: string;
  /** Why it matters + how to satisfy it (goes into the prompt/scaffold). */
  guidance: string;
  /** A ready-to-paste snippet, when one helps. */
  snippet?: string;
}

export interface ApexTestNeeds {
  patterns: ApexTestPattern[];
  /** Convenience: does the class do callouts (needs a mock to be testable)? */
  hasCallouts: boolean;
  /** Convenience: does the class do DML (needs real/created data)? */
  hasDml: boolean;
}

/**
 * Analyses a class's source (and, optionally, the SObjects it touches) into the
 * patterns a test for it must implement.
 */
export function analyzeApexTestNeeds(source: string, touchedObjects: string[] = []): ApexTestNeeds {
  const code = stripCommentsAndStrings(source);
  const patterns: ApexTestPattern[] = [];

  const hasDml = /\b(insert|update|upsert|delete|undelete)\b/i.test(code) || /\bDatabase\.(insert|update|upsert|delete)\b/i.test(code);
  const hasCallouts =
    /\bHttp\b|\bHttpRequest\b|\bHttpResponse\b/.test(code) ||
    /@future\s*\(\s*callout\s*=\s*true/i.test(code) ||
    /\bWebServiceCallout\b|\bWebService\b/.test(code);

  // --- Data setup (almost always needed when the class does DML/SOQL) -------
  if (hasDml || /\[\s*select\b/i.test(code)) {
    const objs = touchedObjects.length ? touchedObjects.join(', ') : 'the SObjects the class uses';
    patterns.push({
      kind: 'testSetup',
      title: '@TestSetup data factory (required fields)',
      guidance:
        `Create the test records in a @TestSetup method, setting EVERY required field on ${objs}. ` +
        `Missing required fields is the #1 Apex test failure (REQUIRED_FIELD_MISSING on insert). ` +
        `Never rely on org data; never hard-code record Ids.`,
      snippet:
        '@TestSetup\nstatic void makeData() {\n    // set every required field\n    // insert new Account(Name = \'Test\');\n}'
    });
  }

  // --- Test.startTest / stopTest -------------------------------------------
  patterns.push({
    kind: 'startStopTest',
    title: 'Test.startTest() / stopTest() boundary',
    guidance:
      'Wrap the code under test in Test.startTest()/Test.stopTest(): it gives a fresh set of governor ' +
      'limits for the exercised code and FORCES asynchronous work (@future/Queueable/Batch) to complete ' +
      'before stopTest() returns, so you can assert its results.'
  });

  // --- Callout mocks --------------------------------------------------------
  if (hasCallouts) {
    const isWs = /\bWebServiceCallout\b|\bWebService\b/.test(code);
    patterns.push(
      isWs
        ? {
            kind: 'wsMock',
            title: 'Test.setMock(WebServiceMock)',
            guidance:
              'This class makes a SOAP/WebService callout. Callouts are not allowed in tests — implement a ' +
              'WebServiceMock and register it with Test.setMock(WebServiceMock.class, new MyMock()) BEFORE the call.',
            snippet:
              'Test.setMock(WebServiceMock.class, new MyWsMock());\n// class MyWsMock implements WebServiceMock { public void doInvoke(...) {...} }'
          }
        : {
            kind: 'httpMock',
            title: 'Test.setMock(HttpCalloutMock)',
            guidance:
              'This class makes an HTTP callout. Callouts are not allowed in tests — implement an ' +
              'HttpCalloutMock returning a canned HttpResponse and register it with ' +
              'Test.setMock(HttpCalloutMock.class, new MyMock()) BEFORE calling the method. Cover a success ' +
              'response AND an error/non-200 response.',
            snippet:
              'Test.setMock(HttpCalloutMock.class, new MyHttpMock());\n' +
              '// class MyHttpMock implements HttpCalloutMock {\n' +
              '//   public HttpResponse respond(HttpRequest req) {\n' +
              '//     HttpResponse res = new HttpResponse();\n' +
              '//     res.setStatusCode(200); res.setBody(\'{"ok":true}\'); return res;\n' +
              '//   }\n' +
              '// }'
          }
    );
  }

  // --- runAs (permissions / user context) ----------------------------------
  const usesRunAsTriggers = /\bUserInfo\b/.test(code) || /\bwith\s+sharing\b/i.test(code) || /\bSchema\.\w+\.(isCreateable|isUpdateable|isDeletable|isAccessible)\b/i.test(code) || /\bStripInaccessible\b/i.test(code);
  if (usesRunAsTriggers) {
    patterns.push({
      kind: 'runAs',
      title: 'System.runAs for permission/sharing paths',
      guidance:
        'The class depends on the running user (UserInfo, sharing, or CRUD/FLS checks). Use System.runAs(user) ' +
        'with a test user of the relevant profile/permission set to exercise both the permitted and denied paths. ' +
        'IMPORTANT: data inserted OUTSIDE a runAs block is owned by the test-context system user; with `with sharing` a ' +
        'low-privilege runAs user may NOT see it. Insert the data the runAs user must see INSIDE that runAs block (or give ' +
        'the user access), and only wrap the specific call under test in runAs — not your whole setup.',
      snippet:
        'User u = /* a User with the right profile/perm set */;\nSystem.runAs(u) {\n    // insert data this user must see HERE, then:\n    // exercise the permission-sensitive path\n}'
    });
  }

  // --- Single-row SOQL assignment throws on no rows ------------------------
  // `SObject x = [SELECT … LIMIT 1];` throws QueryException when empty (NOT null).
  if (/=\s*\[\s*select\b/i.test(code)) {
    patterns.push({
      kind: 'singleRowQuery',
      title: 'Single-row SOQL throws on no rows',
      guidance:
        'The class assigns a SOQL result directly to an sObject variable (e.g. `Account a = [SELECT … LIMIT 1];`). ' +
        'That throws `System.QueryException: List has no rows for assignment to SObject` when the query returns nothing — ' +
        'it does NOT return null. So: (a) for the happy path, insert a matching record and pass ITS real Id (query it back ' +
        'in the test — do not fabricate an Id); (b) to hit the "not found" branch, pass a syntactically-valid Id of the ' +
        'right sObject type that does NOT exist, and assert the QueryException/AuraHandledException is thrown.'
    });
  }

  // --- Async harnesses ------------------------------------------------------
  if (/@future/i.test(code)) {
    patterns.push({
      kind: 'asyncFuture',
      title: '@future execution',
      guidance: 'The class has a @future method. Call it inside Test.startTest()/stopTest() so it runs (and completes) before you assert.'
    });
  }
  if (/\bimplements\b[^\{]*\bQueueable\b/i.test(code) || /\bSystem\.enqueueJob\b/.test(code)) {
    patterns.push({
      kind: 'asyncQueueable',
      title: 'Queueable execution',
      guidance: 'Enqueue with System.enqueueJob(...) inside Test.startTest()/stopTest(); stopTest() forces the job to run.'
    });
  }
  if (/\bimplements\b[^\{]*\bDatabase\.Batchable\b/i.test(code) || /\bDatabase\.executeBatch\b/.test(code)) {
    patterns.push({
      kind: 'asyncBatch',
      title: 'Batchable execution',
      guidance: 'Run Database.executeBatch(new TheBatch()) inside Test.startTest()/stopTest(); stopTest() runs the batch synchronously so you can assert results.'
    });
  }
  if (/\bimplements\b[^\{]*\bSchedulable\b/i.test(code) || /\bSystem\.schedule\b/.test(code)) {
    patterns.push({
      kind: 'asyncSchedule',
      title: 'Schedulable execution',
      guidance: 'Use System.schedule(name, cron, new TheJob()) inside Test.startTest()/stopTest() and assert the CronTrigger / side effects.'
    });
  }

  // --- Exception / negative path -------------------------------------------
  if (/\bthrow\s+new\b/i.test(code) || /\bAuraHandledException\b|\bthrow\b/i.test(code)) {
    patterns.push({
      kind: 'exceptionPath',
      title: 'Negative (exception) test',
      guidance:
        'The class throws on invalid input/state. Add a negative test that triggers the throw and asserts it — ' +
        'use try/catch with Assert plus a fail() if no exception is thrown, or Assert on the caught message.',
      snippet:
        'try {\n    // call with invalid input\n    Assert.fail(\'Expected an exception\');\n} catch (Exception e) {\n    Assert.isInstanceOfType(e, /* ExpectedException */ Exception.class);\n}'
    });
  }

  // --- Always: no seeAllData -----------------------------------------------
  patterns.push({
    kind: 'noSeeAllData',
    title: 'Never @isTest(seeAllData=true)',
    guidance: 'Do not use seeAllData=true. Create all data in the test; org-data-dependent tests are brittle and disallowed in this project.'
  });

  return { patterns, hasCallouts, hasDml };
}

/** Coarsely blanks comments + string literals so keyword scans ignore them. */
function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''");
}
