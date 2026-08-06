/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as fs from 'fs';
import * as path from 'path';

/**
 * Local metadata scaffolds — the same files `sf apex/lightning generate …` would
 * write, but produced in-process. Shelling out to the CLI cold-starts a Node
 * process (seconds) to write a few fixed template files (microseconds); doing it
 * locally makes "create" instant and removes a hard dependency on the CLI just to
 * make an empty class/component.
 *
 * Each builder returns the files to write ({ relPath, content }); `writeScaffold`
 * persists them under a base directory, refusing to clobber existing files (the
 * CLI errors on collision, so we match that rather than silently overwrite).
 */
export interface ScaffoldFile {
  /** Path relative to the scaffold's base directory. */
  relPath: string;
  content: string;
}

/** A generated bundle: files + the primary file to open afterwards. */
export interface Scaffold {
  files: ScaffoldFile[];
  /** Relative path (within base dir) of the file to reveal in the editor. */
  primary: string;
}

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

/** Apex class stub + `-meta.xml` (mirrors `sf apex generate class`). */
export function apexClassScaffold(name: string, apiVersion: string): Scaffold {
  return {
    primary: `${name}.cls`,
    files: [
      {
        relPath: `${name}.cls`,
        content: `public with sharing class ${name} {\n    public ${name}() {\n\n    }\n}\n`
      },
      {
        relPath: `${name}.cls-meta.xml`,
        content: `${XML_HEADER}\n<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>${apiVersion}</apiVersion>\n    <status>Active</status>\n</ApexClass>\n`
      }
    ]
  };
}

/** Apex trigger stub + `-meta.xml` (mirrors `sf apex generate trigger`). */
export function apexTriggerScaffold(name: string, sobject: string, apiVersion: string): Scaffold {
  return {
    primary: `${name}.trigger`,
    files: [
      {
        relPath: `${name}.trigger`,
        content: `trigger ${name} on ${sobject} (before insert) {\n}\n`
      },
      {
        relPath: `${name}.trigger-meta.xml`,
        content: `${XML_HEADER}\n<ApexTrigger xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>${apiVersion}</apiVersion>\n    <status>Active</status>\n</ApexTrigger>\n`
      }
    ]
  };
}

/**
 * LWC bundle: `<name>/<name>.js|.html|.js-meta.xml` (mirrors
 * `sf lightning generate component --type lwc`). Files are nested under a folder
 * named after the component, as the platform requires.
 */
export function lwcScaffold(name: string, apiVersion: string): Scaffold {
  // LWC class names are the component name with an upper-cased first letter.
  const className = name.charAt(0).toUpperCase() + name.slice(1);
  return {
    primary: `${name}/${name}.js`,
    files: [
      {
        relPath: `${name}/${name}.js`,
        content: `import { LightningElement } from 'lwc';\n\nexport default class ${className} extends LightningElement {}\n`
      },
      {
        relPath: `${name}/${name}.html`,
        content: `<template>\n    \n</template>\n`
      },
      {
        relPath: `${name}/${name}.js-meta.xml`,
        content: `${XML_HEADER}\n<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>${apiVersion}</apiVersion>\n    <isExposed>false</isExposed>\n</LightningComponentBundle>\n`
      }
    ]
  };
}

/**
 * Aura bundle: `<name>/<name>.cmp` + `.cmp-meta.xml` + a controller/helper
 * (mirrors `sf lightning generate component --type aura`, minimal variant).
 */
export function auraScaffold(name: string, apiVersion: string): Scaffold {
  return {
    primary: `${name}/${name}.cmp`,
    files: [
      {
        relPath: `${name}/${name}.cmp`,
        content: `<aura:component>\n    \n</aura:component>\n`
      },
      {
        relPath: `${name}/${name}.cmp-meta.xml`,
        content: `${XML_HEADER}\n<AuraDefinitionBundle xmlns="http://soap.sforce.com/2006/04/metadata">\n    <apiVersion>${apiVersion}</apiVersion>\n    <description>A Lightning Component Bundle</description>\n</AuraDefinitionBundle>\n`
      },
      {
        relPath: `${name}/${name}Controller.js`,
        content: `({\n    myAction : function(component, event, helper) {\n\n    }\n})\n`
      }
    ]
  };
}

/**
 * Writes a scaffold under `baseDir`, creating parent folders as needed. Throws if
 * ANY target file already exists (checked up front so a partial bundle is never
 * written). Returns the absolute path of the primary file.
 */
export function writeScaffold(baseDir: string, scaffold: Scaffold): string {
  const targets = scaffold.files.map((f) => ({ ...f, abs: path.join(baseDir, f.relPath) }));

  const existing = targets.find((t) => fs.existsSync(t.abs));
  if (existing) {
    throw new Error(`${path.basename(existing.abs)} already exists in this folder.`);
  }

  for (const t of targets) {
    fs.mkdirSync(path.dirname(t.abs), { recursive: true });
    fs.writeFileSync(t.abs, t.content, 'utf-8');
  }
  return path.join(baseDir, scaffold.primary);
}
