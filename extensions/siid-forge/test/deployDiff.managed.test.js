/*---------------------------------------------------------------------------------------------
 *  Self-check: collectDeployFiles / classify must SKIP managed-package components (a `ns__`
 *  namespace prefix on the fullName) while still collecting first-party components — including
 *  custom-suffix names (`Foo__c` is a valid object/tab name, NOT a managed prefix). Guards the
 *  `trlhdtips__` deploy bug (read-only managed code was bundled and rejected by the org).
 *
 *  No framework — run with: node test/deployDiff.managed.test.js  (after `npm run compile`).
 *--------------------------------------------------------------------------------------------*/
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const dd = require(path.join(__dirname, '..', 'out', 'core', 'deployDiff.js'));

let failures = 0;
function check(name, fn) {
	try {
		fn();
		console.log(`  PASS  ${name}`);
	} catch (err) {
		failures++;
		console.error(`  FAIL  ${name}: ${err.message}`);
	}
}

/** Build a throwaway source tree and return its root. */
function makeTree() {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'siid-forge-mgd-'));
	const classes = path.join(root, 'force-app', 'main', 'default', 'classes');
	const lwc = path.join(root, 'force-app', 'main', 'default', 'lwc', 'myCmp');
	const tabs = path.join(root, 'force-app', 'main', 'default', 'tabs');
	fs.mkdirSync(classes, { recursive: true });
	fs.mkdirSync(lwc, { recursive: true });
	fs.mkdirSync(tabs, { recursive: true });
	// First-party Apex
	fs.writeFileSync(path.join(classes, 'MyService.cls'), 'public class MyService {}');
	fs.writeFileSync(path.join(classes, 'MyService.cls-meta.xml'), '<ApexClass/>');
	// Managed-package Apex (namespace prefix) — MUST be skipped
	fs.writeFileSync(path.join(classes, 'trlhdtips__Utils.cls'), 'global class trlhdtips__Utils {}');
	fs.writeFileSync(path.join(classes, 'trlhdtips__Utils.cls-meta.xml'), '<ApexClass/>');
	// Managed LWC bundle member — MUST be skipped
	fs.writeFileSync(path.join(lwc, 'myCmp.js'), '// first-party');
	const mgdLwc = path.join(root, 'force-app', 'main', 'default', 'lwc', 'ns__theirCmp');
	fs.mkdirSync(mgdLwc, { recursive: true });
	fs.writeFileSync(path.join(mgdLwc, 'theirCmp.js'), '// managed');
	// Custom-suffix tab name (Foo__c) — a legitimate first-party name, MUST be kept
	fs.writeFileSync(path.join(tabs, 'MyObject__c.tab-meta.xml'), '<CustomTab/>');
	return root;
}

check('skips managed (ns__) components, keeps first-party + custom-suffix names', () => {
	const root = makeTree();
	try {
		const files = dd.collectDeployFiles(root);
		const names = files.map((f) => `${f.type}:${f.fullName}`).sort();

		// Managed ones are gone.
		assert.ok(!names.includes('ApexClass:trlhdtips__Utils'), `managed Apex leaked: ${names}`);
		assert.ok(
			!names.some((n) => n.startsWith('LightningComponentBundle:ns__')),
			`managed LWC leaked: ${names}`
		);

		// First-party ones survive.
		assert.ok(names.includes('ApexClass:MyService'), `first-party Apex missing: ${names}`);
		assert.ok(
			names.includes('LightningComponentBundle:myCmp'),
			`first-party LWC missing: ${names}`
		);
		// A custom-suffix name is NOT a managed prefix and must be kept.
		assert.ok(names.includes('CustomTab:MyObject__c'), `custom-suffix name wrongly dropped: ${names}`);
	} finally {
		fs.rmSync(root, { recursive: true, force: true });
	}
});

console.log('');
if (failures > 0) {
	console.error(`${failures} test(s) failed.`);
	process.exit(1);
}
console.log('All deployDiff managed-package tests passed.');
