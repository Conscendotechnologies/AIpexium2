/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { RoocodeMode } from '../common/roocode.js';
import { RoocodeAIService } from './roocodeAIService.js';
import { RoocodeFileSystemService } from './roocodeFileSystemService.js';

/**
 * Base class for Roo Code mode handlers
 */
export abstract class RoocodeModeHandler extends Disposable {
	constructor(
		protected readonly mode: RoocodeMode,
		@ILogService protected readonly logService: ILogService
	) {
		super();
		this.logService.info(`RoocodeModeHandler: Initializing ${mode} mode handler`);
	}

	abstract handleRequest(input: string, context?: any): Promise<any>;
}

/**
 * Code mode handler - for code generation and editing
 */
export class RoocodeCodeModeHandler extends RoocodeModeHandler {
	constructor(
		@ILogService logService: ILogService,
		private readonly aiService: RoocodeAIService
	) {
		super(RoocodeMode.Code, logService);
	}

	async handleRequest(input: string, context?: {
		fileName?: string;
		existingCode?: string;
		language?: string;
		fileContent?: string;
		selectionStart?: number;
		selectionEnd?: number;
	}): Promise<string> {
		this.logService.info('RoocodeCodeModeHandler: Handling code generation request');

		try {
			// Auto-detect language from filename if not provided
			const detectedLanguage = context?.language || this.detectLanguageFromFileName(context?.fileName);

			// Build context-aware prompt
			let prompt = this.buildCodePrompt(input, {
				language: detectedLanguage,
				existingCode: context?.existingCode,
				fileContent: context?.fileContent,
				fileName: context?.fileName,
				selectionStart: context?.selectionStart,
				selectionEnd: context?.selectionEnd
			});

			const generatedCode = await this.aiService.generateCode(prompt);

			// Validate generated code syntax if possible
			const validatedCode = this.validateCodeSyntax(generatedCode, detectedLanguage);

			return validatedCode;
		} catch (error) {
			this.logService.error('RoocodeCodeModeHandler: Code generation failed', error);
			throw error;
		}
	}

	/**
	 * Detect programming language from filename
	 */
	private detectLanguageFromFileName(fileName?: string): string {
		if (!fileName) return 'text';

		const ext = fileName.split('.').pop()?.toLowerCase();
		const languageMap: Record<string, string> = {
			'ts': 'typescript',
			'js': 'javascript',
			'jsx': 'javascript',
			'tsx': 'typescript',
			'py': 'python',
			'java': 'java',
			'c': 'c',
			'cpp': 'cpp',
			'cs': 'csharp',
			'go': 'go',
			'rs': 'rust',
			'php': 'php',
			'rb': 'ruby',
			'swift': 'swift',
			'kt': 'kotlin',
			'scala': 'scala',
			'html': 'html',
			'css': 'css',
			'scss': 'scss',
			'json': 'json',
			'xml': 'xml',
			'yaml': 'yaml',
			'yml': 'yaml',
			'md': 'markdown',
			'sql': 'sql',
			'sh': 'bash',
			'ps1': 'powershell'
		};

		return languageMap[ext || ''] || 'text';
	}

	/**
	 * Build context-aware code prompt
	 */
	private buildCodePrompt(input: string, context: {
		language?: string;
		existingCode?: string;
		fileContent?: string;
		fileName?: string;
		selectionStart?: number;
		selectionEnd?: number;
	}): string {
		let prompt = '';

		// Add language context
		if (context.language && context.language !== 'text') {
			prompt += `Language: ${context.language}\n\n`;
		}

		// Add file context
		if (context.fileName) {
			prompt += `File: ${context.fileName}\n\n`;
		}

		// Handle different scenarios
		if (context.existingCode) {
			if (context.selectionStart !== undefined && context.selectionEnd !== undefined) {
				// Code modification with selection
				prompt += `Modify the selected code (lines ${context.selectionStart}-${context.selectionEnd}):\n\n`;
				prompt += `Current code:\n\`\`\`${context.language}\n${context.existingCode}\n\`\`\`\n\n`;
				prompt += `Instructions: ${input}`;
			} else {
				// General code modification
				prompt += `Modify this code:\n\n\`\`\`${context.language}\n${context.existingCode}\n\`\`\`\n\n`;
				prompt += `Instructions: ${input}`;
			}
		} else if (context.fileContent) {
			// Code generation within existing file context
			prompt += `Context from file:\n\`\`\`${context.language}\n${context.fileContent}\n\`\`\`\n\n`;
			prompt += `Generate ${context.language} code: ${input}`;
		} else {
			// Fresh code generation
			if (context.language && context.language !== 'text') {
				prompt += `Generate ${context.language} code: ${input}`;
			} else {
				prompt += `Generate code: ${input}`;
			}
		}

		return prompt;
	}

	/**
	 * Basic code syntax validation
	 */
	private validateCodeSyntax(code: string, language?: string): string {
		// Remove markdown code blocks if present
		const cleanCode = code.replace(/^```[\w]*\n?|```$/g, '').trim();

		// Basic validation checks
		if (!cleanCode) {
			throw new Error('Generated code is empty');
		}

		// Language-specific validation
		if (language) {
			switch (language) {
				case 'javascript':
				case 'typescript':
					return this.validateJavaScriptSyntax(cleanCode);
				case 'python':
					return this.validatePythonSyntax(cleanCode);
				case 'json':
					return this.validateJsonSyntax(cleanCode);
				default:
					return cleanCode;
			}
		}

		return cleanCode;
	}

	/**
	 * Basic JavaScript/TypeScript syntax validation
	 */
	private validateJavaScriptSyntax(code: string): string {
		// Check for balanced braces
		const openBraces = (code.match(/{/g) || []).length;
		const closeBraces = (code.match(/}/g) || []).length;

		if (openBraces !== closeBraces) {
			this.logService.warn('RoocodeCodeModeHandler: Unbalanced braces detected in generated code');
		}

		// Check for balanced parentheses
		const openParens = (code.match(/\(/g) || []).length;
		const closeParens = (code.match(/\)/g) || []).length;

		if (openParens !== closeParens) {
			this.logService.warn('RoocodeCodeModeHandler: Unbalanced parentheses detected in generated code');
		}

		return code;
	}

	/**
	 * Basic Python syntax validation
	 */
	private validatePythonSyntax(code: string): string {
		// Check for consistent indentation (basic check)
		const lines = code.split('\n');

		for (const line of lines) {
			if (line.trim()) {
				const indent = line.length - line.trimStart().length;
				// Python indentation should be consistent (multiples of 4 or consistent tabs)
				if (indent % 4 !== 0 && indent > 0) {
					this.logService.warn('RoocodeCodeModeHandler: Inconsistent indentation detected in Python code');
					break;
				}
			}
		}

		return code;
	}

	/**
	 * JSON syntax validation
	 */
	private validateJsonSyntax(code: string): string {
		try {
			JSON.parse(code);
			return code;
		} catch (error) {
			this.logService.warn('RoocodeCodeModeHandler: Invalid JSON syntax detected');
			return code; // Return anyway, let user handle
		}
	}
}

/**
 * Architect mode handler - for architecture and design
 */
export class RoocodeArchitectModeHandler extends RoocodeModeHandler {
	constructor(
		@ILogService logService: ILogService,
		private readonly aiService: RoocodeAIService
	) {
		super(RoocodeMode.Architect, logService);
	}

	async handleRequest(input: string, context?: {
		existingArchitecture?: string;
		constraints?: string[];
		projectType?: string;
		scalingRequirements?: string;
		techStack?: string[];
		patterns?: string[];
	}): Promise<string> {
		this.logService.info('RoocodeArchitectModeHandler: Handling architecture design request');

		try {
			const prompt = this.buildArchitecturePrompt(input, {
				existingArchitecture: context?.existingArchitecture,
				constraints: context?.constraints,
				projectType: context?.projectType,
				scalingRequirements: context?.scalingRequirements,
				techStack: context?.techStack,
				patterns: context?.patterns
			});

			const architecture = await this.aiService.designArchitecture(prompt);
			return this.formatArchitectureResponse(architecture);
		} catch (error) {
			this.logService.error('RoocodeArchitectModeHandler: Architecture design failed', error);
			throw error;
		}
	}

	/**
	 * Build comprehensive architecture prompt
	 */
	private buildArchitecturePrompt(input: string, context: {
		existingArchitecture?: string;
		constraints?: string[];
		projectType?: string;
		scalingRequirements?: string;
		techStack?: string[];
		patterns?: string[];
	}): string {
		let prompt = 'Design a software architecture with the following requirements:\n\n';
		prompt += `Requirements: ${input}\n\n`;

		// Add project type context
		if (context.projectType) {
			prompt += `Project Type: ${context.projectType}\n\n`;
		}

		// Add existing architecture context
		if (context.existingArchitecture) {
			prompt += `Current Architecture:\n${context.existingArchitecture}\n\n`;
			prompt += `Please modify or extend the existing architecture to meet the new requirements.\n\n`;
		}

		// Add technical constraints
		if (context.constraints && context.constraints.length > 0) {
			prompt += `Constraints:\n${context.constraints.map(c => `- ${c}`).join('\n')}\n\n`;
		}

		// Add technology stack preferences
		if (context.techStack && context.techStack.length > 0) {
			prompt += `Preferred Technology Stack:\n${context.techStack.map(t => `- ${t}`).join('\n')}\n\n`;
		}

		// Add scaling requirements
		if (context.scalingRequirements) {
			prompt += `Scaling Requirements: ${context.scalingRequirements}\n\n`;
		}

		// Add architectural patterns
		if (context.patterns && context.patterns.length > 0) {
			prompt += `Consider these architectural patterns:\n${context.patterns.map(p => `- ${p}`).join('\n')}\n\n`;
		}

		// Add specific output format instructions
		prompt += `Please provide:
1. High-level architecture overview
2. Component breakdown with responsibilities
3. Data flow and interactions
4. Technology stack recommendations
5. Deployment considerations
6. Security considerations
7. Scalability strategies
8. Potential risks and mitigation strategies`;

		return prompt;
	}

	/**
	 * Format architecture response for better readability
	 */
	private formatArchitectureResponse(response: string): string {
		// Add markdown formatting if not already present
		let formatted = response;

		// Ensure proper section headers
		if (!formatted.includes('#')) {
			// Add basic structure if response lacks formatting
			const sections = [
				'Architecture Overview',
				'Components',
				'Data Flow',
				'Technology Stack',
				'Deployment',
				'Security',
				'Scalability',
				'Risks & Mitigation'
			];

			// Try to identify sections and add headers
			sections.forEach(section => {
				const regex = new RegExp(`(${section}[:\\s]*)`, 'gi');
				formatted = formatted.replace(regex, `\n## ${section}\n\n`);
			});
		}

		return formatted.trim();
	}
}

/**
 * Ask mode handler - for Q&A and documentation
 */
export class RoocodeAskModeHandler extends RoocodeModeHandler {
	constructor(
		@ILogService logService: ILogService,
		private readonly aiService: RoocodeAIService,
		private readonly fileService: RoocodeFileSystemService
	) {
		super(RoocodeMode.Ask, logService);
	}

	async handleRequest(input: string, context?: {
		codeContext?: string;
		files?: string[];
		includeWorkspace?: boolean;
		includeDocumentation?: boolean;
		searchFiles?: string[];
		filePatterns?: string[];
		contextDepth?: 'shallow' | 'medium' | 'deep';
	}): Promise<string> {
		this.logService.info('RoocodeAskModeHandler: Handling question');

		try {
			const workspaceContext = await this.gatherWorkspaceContext(context);
			const prompt = this.buildAskPrompt(input, workspaceContext, context);

			const answer = await this.aiService.answerQuestion(prompt);
			return this.formatAskResponse(answer, workspaceContext);
		} catch (error) {
			this.logService.error('RoocodeAskModeHandler: Question handling failed', error);
			throw error;
		}
	}

	/**
	 * Gather comprehensive workspace context for the question
	 */
	private async gatherWorkspaceContext(context?: {
		codeContext?: string;
		files?: string[];
		includeWorkspace?: boolean;
		includeDocumentation?: boolean;
		searchFiles?: string[];
		filePatterns?: string[];
		contextDepth?: 'shallow' | 'medium' | 'deep';
	}): Promise<{
		workspaceInfo: string;
		relevantFiles: string[];
		fileContents: string;
		codeContext: string;
		documentation: string;
		projectStructure: string;
	}> {
		const result = {
			workspaceInfo: '',
			relevantFiles: [] as string[],
			fileContents: '',
			codeContext: context?.codeContext || '',
			documentation: '',
			projectStructure: ''
		};

		try {
			// Include existing code context
			if (context?.codeContext) {
				result.codeContext = context.codeContext;
			}

			// If files are provided, read and include their content
			if (context?.files && context.files.length > 0) {
				const fileContents: string[] = [];
				for (const filePath of context.files) {
					const uri = this.fileService.resolveWorkspacePath(filePath);
					if (uri) {
						const content = await this.fileService.readFile(uri);
						fileContents.push(`File: ${filePath}\n${content}`);
						result.relevantFiles.push(filePath);
					}
				}
				result.fileContents = fileContents.join('\n\n---\n\n');
			}

			// Search for additional relevant files if patterns provided
			if (context?.filePatterns && context.filePatterns.length > 0) {
				const additionalFiles = await this.findRelevantFiles(context.filePatterns);
				for (const filePath of additionalFiles) {
					if (!result.relevantFiles.includes(filePath)) {
						const uri = this.fileService.resolveWorkspacePath(filePath);
						if (uri) {
							try {
								const content = await this.fileService.readFile(uri);
								result.fileContents += `\n\n---\n\nFile: ${filePath}\n${content}`;
								result.relevantFiles.push(filePath);
							} catch (error) {
								this.logService.warn('Failed to read file', filePath, error);
							}
						}
					}
				}
			}

			// Include specific search files if requested
			if (context?.searchFiles && context.searchFiles.length > 0) {
				for (const filePath of context.searchFiles) {
					if (!result.relevantFiles.includes(filePath)) {
						const uri = this.fileService.resolveWorkspacePath(filePath);
						if (uri) {
							try {
								const content = await this.fileService.readFile(uri);
								result.fileContents += `\n\n---\n\nFile: ${filePath}\n${content}`;
								result.relevantFiles.push(filePath);
							} catch (error) {
								this.logService.warn('Failed to read search file', filePath, error);
							}
						}
					}
				}
			}

			// Gather workspace context if requested
			if (context?.includeWorkspace) {
				result.workspaceInfo = this.getWorkspaceInfo();
				const depth = context.contextDepth || 'medium';
				result.projectStructure = await this.getProjectStructure(depth);
			}

			// Gather documentation if requested
			if (context?.includeDocumentation) {
				result.documentation = await this.gatherDocumentation();
			}

		} catch (error) {
			this.logService.warn('RoocodeAskModeHandler: Failed to gather workspace context', error);
		}

		return result;
	}

	/**
	 * Find files matching the given patterns
	 */
	private async findRelevantFiles(patterns: string[]): Promise<string[]> {
		const files: string[] = [];

		// This is a simplified implementation
		// In reality, you'd use the file service to search for files
		patterns.forEach(pattern => {
			if (pattern.includes('*.ts') || pattern.includes('*.js')) {
				files.push('src/main.ts', 'src/types.ts');
			}
			if (pattern.includes('*.json')) {
				files.push('package.json', 'tsconfig.json');
			}
			if (pattern.includes('README') || pattern.includes('*.md')) {
				files.push('README.md', 'CONTRIBUTING.md');
			}
			if (pattern.includes('test') || pattern.includes('spec')) {
				files.push('test/index.ts', 'src/test.ts');
			}
		});

		return files;
	}

	/**
	 * Get basic workspace information
	 */
	private getWorkspaceInfo(): string {
		try {
			// In a real implementation, you'd get this from workspace service
			return 'VS Code Extension Development Workspace';
		} catch (error) {
			return 'Unable to determine workspace type';
		}
	}

	/**
	 * Get project structure based on depth setting
	 */
	private async getProjectStructure(depth: 'shallow' | 'medium' | 'deep'): Promise<string> {
		try {
			let structure = 'Project Structure:\n';

			const commonFiles = [
				'package.json', 'tsconfig.json', 'README.md', 'CONTRIBUTING.md',
				'src/', 'test/', 'docs/', 'scripts/', 'build/', 'extensions/'
			];

			switch (depth) {
				case 'shallow':
					structure += commonFiles.slice(0, 4).map(f => `- ${f}`).join('\n');
					break;
				case 'medium':
					structure += commonFiles.slice(0, 8).map(f => `- ${f}`).join('\n');
					break;
				case 'deep':
					structure += commonFiles.map(f => `- ${f}`).join('\n');
					structure += '\n- out/\n- remote/\n- cli/';
					break;
			}

			return structure;
		} catch (error) {
			return 'Unable to read project structure';
		}
	}

	/**
	 * Gather documentation from common locations
	 */
	private async gatherDocumentation(): Promise<string> {
		let docs = '';

		const docFiles = ['README.md', 'CONTRIBUTING.md', 'docs/'];

		// In reality, you'd read the actual file contents using fileService
		docFiles.forEach(file => {
			docs += `Documentation available: ${file}\n`;
		});

		return docs || 'No documentation found';
	}

	/**
	 * Build comprehensive prompt for the question
	 */
	private buildAskPrompt(input: string, workspaceContext: {
		workspaceInfo: string;
		relevantFiles: string[];
		fileContents: string;
		codeContext: string;
		documentation: string;
		projectStructure: string;
	}, context?: any): string {
		let prompt = `Question: ${input}\n\n`;

		// Add workspace context if available
		if (workspaceContext.workspaceInfo) {
			prompt += `Workspace: ${workspaceContext.workspaceInfo}\n\n`;
		}

		if (workspaceContext.projectStructure) {
			prompt += `${workspaceContext.projectStructure}\n\n`;
		}

		// Add code context
		if (workspaceContext.codeContext) {
			prompt += `Code Context:\n${workspaceContext.codeContext}\n\n`;
		}

		// Add file contents
		if (workspaceContext.fileContents) {
			prompt += `Relevant Files:\n${workspaceContext.fileContents}\n\n`;
		}

		// Add documentation context
		if (workspaceContext.documentation) {
			prompt += `Available Documentation:\n${workspaceContext.documentation}\n\n`;
		}

		prompt += `Please provide a comprehensive and accurate answer considering all the provided context.`;

		return prompt;
	}

	/**
	 * Format the response with context information
	 */
	private formatAskResponse(answer: string, workspaceContext: {
		workspaceInfo: string;
		relevantFiles: string[];
		fileContents: string;
		codeContext: string;
		documentation: string;
		projectStructure: string;
	}): string {
		let formatted = answer;

		// Add context footer if workspace context was used
		if (workspaceContext.relevantFiles.length > 0 || workspaceContext.codeContext || workspaceContext.workspaceInfo) {
			formatted += '\n\n---\n\n';
			formatted += '*Answer based on provided context*';

			if (workspaceContext.relevantFiles.length > 0) {
				formatted += `\n\nFiles analyzed: ${workspaceContext.relevantFiles.join(', ')}`;
			}

			if (workspaceContext.workspaceInfo) {
				formatted += `\nWorkspace: ${workspaceContext.workspaceInfo}`;
			}
		}

		return formatted;
	}
}

/**
 * Debug mode handler - for debugging assistance
 */
export class RoocodeDebugModeHandler extends RoocodeModeHandler {
	constructor(
		@ILogService logService: ILogService,
		private readonly aiService: RoocodeAIService,
		private readonly fileService: RoocodeFileSystemService
	) {
		super(RoocodeMode.Debug, logService);
	}

	async handleRequest(input: string, context?: {
		code?: string;
		errorMessage?: string;
		stackTrace?: string;
		fileName?: string;
		language?: string;
		projectType?: string;
		debugLevel?: 'basic' | 'detailed' | 'comprehensive';
		includeRelatedFiles?: boolean;
		errorType?: 'runtime' | 'compile' | 'logic' | 'performance' | 'unknown';
	}): Promise<string> {
		this.logService.info('RoocodeDebugModeHandler: Handling debug request');

		try {
			const debugContext = await this.gatherDebugContext(input, context);
			const analysis = this.analyzeError(debugContext);
			const prompt = this.buildDebugPrompt(debugContext, analysis);

			const debugSuggestion = await this.aiService.debugCode(debugContext.code, prompt);
			return this.formatDebugResponse(debugSuggestion, analysis);
		} catch (error) {
			this.logService.error('RoocodeDebugModeHandler: Debug handling failed', error);
			throw error;
		}
	}

	/**
	 * Gather comprehensive debug context
	 */
	private async gatherDebugContext(input: string, context?: {
		code?: string;
		errorMessage?: string;
		stackTrace?: string;
		fileName?: string;
		language?: string;
		projectType?: string;
		debugLevel?: 'basic' | 'detailed' | 'comprehensive';
		includeRelatedFiles?: boolean;
		errorType?: 'runtime' | 'compile' | 'logic' | 'performance' | 'unknown';
	}): Promise<{
		input: string;
		code: string;
		errorMessage: string;
		stackTrace: string;
		fileName: string;
		language: string;
		projectType: string;
		debugLevel: string;
		relatedFiles: string[];
		errorType: string;
	}> {
		let code = context?.code || '';
		let fileName = context?.fileName || '';
		let language = context?.language || '';
		const relatedFiles: string[] = [];

		// If no code provided but fileName is given, read from file
		if (!code && fileName) {
			const uri = this.fileService.resolveWorkspacePath(fileName);
			if (uri) {
				code = await this.fileService.readFile(uri);
				if (!language) {
					language = this.detectLanguageFromFileName(fileName);
				}
			}
		}

		// Detect language from code if not provided
		if (!language && code) {
			language = this.detectLanguageFromCode(code);
		}

		// Gather related files if requested and we have detailed debugging
		if (context?.includeRelatedFiles && (context?.debugLevel === 'detailed' || context?.debugLevel === 'comprehensive')) {
			if (fileName) {
				const related = await this.findRelatedFiles(fileName, language);
				relatedFiles.push(...related);
			}
		}

		// Auto-detect project type if not provided
		const projectType = context?.projectType || await this.detectProjectType();

		return {
			input,
			code,
			errorMessage: context?.errorMessage || '',
			stackTrace: context?.stackTrace || '',
			fileName,
			language,
			projectType,
			debugLevel: context?.debugLevel || 'detailed',
			relatedFiles,
			errorType: context?.errorType || this.classifyError(context?.errorMessage, context?.stackTrace)
		};
	}

	/**
	 * Detect programming language from file name
	 */
	private detectLanguageFromFileName(fileName: string): string {
		const ext = fileName.split('.').pop()?.toLowerCase();
		const languageMap: { [key: string]: string } = {
			'ts': 'typescript',
			'js': 'javascript',
			'py': 'python',
			'java': 'java',
			'cs': 'csharp',
			'cpp': 'cpp',
			'c': 'c',
			'php': 'php',
			'rb': 'ruby',
			'go': 'go',
			'rs': 'rust',
			'swift': 'swift',
			'kt': 'kotlin',
			'json': 'json',
			'html': 'html',
			'css': 'css',
			'sql': 'sql'
		};
		return languageMap[ext || ''] || 'unknown';
	}

	/**
	 * Detect language from code patterns
	 */
	private detectLanguageFromCode(code: string): string {
		// Simple pattern matching for language detection
		if (code.includes('import ') && code.includes('from ') && code.includes(':')) return 'python';
		if (code.includes('function') && code.includes('=>')) return 'javascript';
		if (code.includes('interface') && code.includes(': ')) return 'typescript';
		if (code.includes('public class') && code.includes('{')) return 'java';
		if (code.includes('namespace') && code.includes('using')) return 'csharp';
		if (code.includes('#include') && code.includes('int main')) return 'cpp';
		if (code.includes('package main') && code.includes('func')) return 'go';
		if (code.includes('fn main') && code.includes('let')) return 'rust';
		return 'unknown';
	}

	/**
	 * Find files related to the problematic file
	 */
	private async findRelatedFiles(fileName: string, language: string): Promise<string[]> {
		const related: string[] = [];

		// Get base name and directory
		const baseName = fileName.replace(/\.[^/.]+$/, '');
		const dir = fileName.substring(0, fileName.lastIndexOf('/'));

		// Common related file patterns
		const patterns = [
			`${baseName}.test.${this.getFileExtension(language)}`,
			`${baseName}.spec.${this.getFileExtension(language)}`,
			`${dir}/test.${this.getFileExtension(language)}`,
			`${dir}/index.${this.getFileExtension(language)}`,
			`${baseName}.d.ts`, // TypeScript definitions
			'package.json', // Dependencies
			'tsconfig.json', // TypeScript config
			'.eslintrc.json' // Linting config
		];

		// In a real implementation, you'd check if these files exist
		patterns.forEach(pattern => {
			related.push(pattern);
		});

		return related.slice(0, 3); // Limit to avoid too much context
	}

	/**
	 * Get file extension for language
	 */
	private getFileExtension(language: string): string {
		const extMap: { [key: string]: string } = {
			'typescript': 'ts',
			'javascript': 'js',
			'python': 'py',
			'java': 'java',
			'csharp': 'cs',
			'cpp': 'cpp',
			'c': 'c',
			'php': 'php',
			'ruby': 'rb',
			'go': 'go',
			'rust': 'rs'
		};
		return extMap[language] || 'txt';
	}

	/**
	 * Auto-detect project type
	 */
	private async detectProjectType(): Promise<string> {
		// In a real implementation, you'd check for specific files
		// For now, return a default based on the VS Code context
		return 'vscode-extension';
	}

	/**
	 * Classify the type of error
	 */
	private classifyError(errorMessage?: string, stackTrace?: string): string {
		if (!errorMessage && !stackTrace) return 'unknown';

		const text = (errorMessage || '') + ' ' + (stackTrace || '');
		const lowerText = text.toLowerCase();

		if (lowerText.includes('syntaxerror') || lowerText.includes('parse error')) return 'compile';
		if (lowerText.includes('typeerror') || lowerText.includes('referenceerror')) return 'runtime';
		if (lowerText.includes('timeout') || lowerText.includes('slow')) return 'performance';
		if (lowerText.includes('logic') || lowerText.includes('assertion')) return 'logic';

		return 'runtime'; // Default assumption
	}

	/**
	 * Analyze the error context
	 */
	private analyzeError(debugContext: {
		input: string;
		code: string;
		errorMessage: string;
		stackTrace: string;
		fileName: string;
		language: string;
		projectType: string;
		debugLevel: string;
		relatedFiles: string[];
		errorType: string;
	}): {
		severity: 'low' | 'medium' | 'high' | 'critical';
		category: string;
		commonPatterns: string[];
		suggestedActions: string[];
	} {
		const analysis = {
			severity: 'medium' as 'low' | 'medium' | 'high' | 'critical',
			category: debugContext.errorType,
			commonPatterns: [] as string[],
			suggestedActions: [] as string[]
		};

		// Analyze severity
		if (debugContext.stackTrace.includes('FATAL') || debugContext.errorMessage.includes('CRITICAL')) {
			analysis.severity = 'critical';
		} else if (debugContext.errorMessage.includes('Error') || debugContext.stackTrace.length > 500) {
			analysis.severity = 'high';
		} else if (debugContext.errorMessage.includes('Warning')) {
			analysis.severity = 'low';
		}

		// Identify common patterns
		const errorText = debugContext.errorMessage.toLowerCase();
		if (errorText.includes('undefined')) {
			analysis.commonPatterns.push('Undefined variable/property access');
			analysis.suggestedActions.push('Check variable initialization');
		}
		if (errorText.includes('null')) {
			analysis.commonPatterns.push('Null reference');
			analysis.suggestedActions.push('Add null checks');
		}
		if (errorText.includes('async') || errorText.includes('promise')) {
			analysis.commonPatterns.push('Async/Promise handling issue');
			analysis.suggestedActions.push('Review async/await usage');
		}

		return analysis;
	}

	/**
	 * Build comprehensive debug prompt
	 */
	private buildDebugPrompt(debugContext: {
		input: string;
		code: string;
		errorMessage: string;
		stackTrace: string;
		fileName: string;
		language: string;
		projectType: string;
		debugLevel: string;
		relatedFiles: string[];
		errorType: string;
	}, analysis: {
		severity: string;
		category: string;
		commonPatterns: string[];
		suggestedActions: string[];
	}): string {
		let prompt = `Debug Request: ${debugContext.input}\n\n`;

		// Add context information
		prompt += `Language: ${debugContext.language}\n`;
		prompt += `Project Type: ${debugContext.projectType}\n`;
		prompt += `Error Type: ${debugContext.errorType}\n`;
		prompt += `Severity: ${analysis.severity}\n\n`;

		// Add code if available
		if (debugContext.code) {
			prompt += `Code:\n\`\`\`${debugContext.language}\n${debugContext.code}\n\`\`\`\n\n`;
		}

		// Add error information
		if (debugContext.errorMessage) {
			prompt += `Error Message:\n${debugContext.errorMessage}\n\n`;
		}

		if (debugContext.stackTrace) {
			prompt += `Stack Trace:\n${debugContext.stackTrace}\n\n`;
		}

		// Add analysis if patterns found
		if (analysis.commonPatterns.length > 0) {
			prompt += `Detected Patterns:\n${analysis.commonPatterns.map(p => `- ${p}`).join('\n')}\n\n`;
		}

		// Add debug level specific instructions
		if (debugContext.debugLevel === 'comprehensive') {
			prompt += `Please provide:
1. Root cause analysis
2. Step-by-step debugging approach
3. Multiple solution options with pros/cons
4. Prevention strategies
5. Related best practices
6. Code examples for fixes`;
		} else if (debugContext.debugLevel === 'detailed') {
			prompt += `Please provide:
1. Problem identification
2. Recommended solution
3. Code fix example
4. Prevention tips`;
		} else {
			prompt += `Please provide a concise solution to fix this issue.`;
		}

		return prompt;
	}

	/**
	 * Format debug response with additional context
	 */
	private formatDebugResponse(response: string, analysis: {
		severity: string;
		category: string;
		commonPatterns: string[];
		suggestedActions: string[];
	}): string {
		let formatted = response;

		// Add severity indicator
		const severityEmoji = {
			'low': '🟡',
			'medium': '🟠',
			'high': '🔴',
			'critical': '🚨'
		};

		formatted = `${severityEmoji[analysis.severity as keyof typeof severityEmoji]} **${analysis.severity.toUpperCase()} SEVERITY**\n\n${formatted}`;

		// Add quick actions if available
		if (analysis.suggestedActions.length > 0) {
			formatted += '\n\n**Quick Actions:**\n';
			formatted += analysis.suggestedActions.map(action => `- ${action}`).join('\n');
		}

		return formatted;
	}
}

/**
 * Custom mode handler - for custom workflows
 */
export class RoocodeCustomModeHandler extends RoocodeModeHandler {
	constructor(
		@ILogService logService: ILogService,
		private readonly aiService: RoocodeAIService
	) {
		super(RoocodeMode.Custom, logService);
	}

	async handleRequest(input: string, context?: {
		workflow?: string;
		steps?: string[];
		parameters?: Record<string, any>;
		template?: string;
		outputFormat?: 'text' | 'json' | 'markdown' | 'code';
		variables?: Record<string, any>;
		validation?: {
			required?: string[];
			schema?: Record<string, any>;
		};
		chainMode?: boolean;
		retryOnFailure?: boolean;
		maxRetries?: number;
	}): Promise<any> {
		this.logService.info('RoocodeCustomModeHandler: Handling custom workflow');

		try {
			// Validate input parameters if validation rules provided
			if (context?.validation) {
				this.validateInputs(context.parameters || {}, context.validation);
			}

			// Execute predefined workflow if specified
			if (context?.workflow) {
				return await this.executeWorkflow(input, context);
			}

			// Execute custom steps if provided
			if (context?.steps && context.steps.length > 0) {
				return await this.executeSteps(input, context);
			}

			// Execute template-based processing if template provided
			if (context?.template) {
				return await this.executeTemplate(input, context);
			}

			// Default: treat as a general AI request with custom formatting
			const response = await this.aiService.answerQuestion(input);
			return this.formatResponse(response, context?.outputFormat || 'text');
		} catch (error) {
			if (context?.retryOnFailure && this.shouldRetry(error)) {
				const maxRetries = context.maxRetries || 3;
				this.logService.warn(`RoocodeCustomModeHandler: Retrying workflow (max: ${maxRetries})`);
				return await this.retryRequest(input, context, maxRetries);
			}

			this.logService.error('RoocodeCustomModeHandler: Custom workflow failed', error);
			throw error;
		}
	}

	/**
	 * Validate inputs against schema
	 */
	private validateInputs(parameters: Record<string, any>, validation: {
		required?: string[];
		schema?: Record<string, any>;
	}): void {
		// Check required parameters
		if (validation.required) {
			const missing = validation.required.filter(key => !(key in parameters));
			if (missing.length > 0) {
				throw new Error(`Missing required parameters: ${missing.join(', ')}`);
			}
		}

		// Basic schema validation (simplified)
		if (validation.schema) {
			Object.entries(validation.schema).forEach(([key, expectedType]) => {
				if (key in parameters) {
					const actualType = typeof parameters[key];
					if (actualType !== expectedType) {
						throw new Error(`Parameter '${key}' expected type ${expectedType}, got ${actualType}`);
					}
				}
			});
		}
	}

	/**
	 * Execute predefined workflow
	 */
	private async executeWorkflow(input: string, context: {
		workflow?: string;
		parameters?: Record<string, any>;
		variables?: Record<string, any>;
		outputFormat?: string;
		chainMode?: boolean;
	}): Promise<any> {
		this.logService.info(`Executing custom workflow: ${context.workflow}`);

		const workflows = this.getBuiltInWorkflows();
		const workflow = workflows[context.workflow!];

		if (!workflow) {
			throw new Error(`Unknown workflow: ${context.workflow}`);
		}

		// Replace variables in workflow steps
		const processedSteps = this.processVariables(workflow.steps, {
			...context.variables,
			...context.parameters,
			input
		});

		// Execute workflow steps
		const results = [];
		let previousResult = input;

		for (let i = 0; i < processedSteps.length; i++) {
			const step = processedSteps[i];
			this.logService.info(`Executing workflow step ${i + 1}: ${step.name}`);

			try {
				const stepInput = context.chainMode ? previousResult : input;
				const result = await this.executeWorkflowStep(step, stepInput, context.parameters);

				results.push({
					step: step.name,
					status: 'completed',
					result: result
				});

				if (context.chainMode) {
					previousResult = result;
				}
			} catch (error) {
				results.push({
					step: step.name,
					status: 'failed',
					error: error.message
				});

				if (!step.continueOnError) {
					throw error;
				}
			}
		}

		return {
			workflow: context.workflow,
			results,
			finalResult: context.chainMode ? previousResult : results
		};
	}

	/**
	 * Execute custom steps
	 */
	private async executeSteps(input: string, context: {
		steps?: string[];
		parameters?: Record<string, any>;
		variables?: Record<string, any>;
		chainMode?: boolean;
		outputFormat?: string;
	}): Promise<any> {
		const results = [];
		let previousResult = input;

		for (let i = 0; i < context.steps!.length; i++) {
			const step = context.steps![i];
			this.logService.info(`Executing step ${i + 1}: ${step}`);

			try {
				const stepInput = context.chainMode ? previousResult : input;
				const processedStep = this.processVariables([{ action: step }], {
					...context.variables,
					...context.parameters,
					input: stepInput
				})[0];

				const result = await this.aiService.answerQuestion(
					`${processedStep.action}\n\nInput: ${stepInput}`
				);

				results.push({
					step,
					status: 'completed',
					result: this.formatResponse(result, context.outputFormat)
				});

				if (context.chainMode) {
					previousResult = result;
				}
			} catch (error) {
				results.push({
					step,
					status: 'failed',
					error: error.message
				});
				throw error;
			}
		}

		return {
			steps: context.steps,
			results,
			finalResult: context.chainMode ? previousResult : results
		};
	}

	/**
	 * Execute template-based processing
	 */
	private async executeTemplate(input: string, context: {
		template?: string;
		variables?: Record<string, any>;
		parameters?: Record<string, any>;
		outputFormat?: string;
	}): Promise<any> {
		let processedTemplate = context.template!;

		// Replace variables in template
		const allVariables = {
			...context.variables,
			...context.parameters,
			input
		};

		Object.entries(allVariables).forEach(([key, value]) => {
			const placeholder = `{{${key}}}`;
			processedTemplate = processedTemplate.replace(new RegExp(placeholder, 'g'), String(value));
		});

		this.logService.info('Executing template-based processing');
		const result = await this.aiService.answerQuestion(processedTemplate);

		return {
			template: context.template,
			processedTemplate,
			result: this.formatResponse(result, context.outputFormat)
		};
	}

	/**
	 * Get built-in workflow definitions
	 */
	private getBuiltInWorkflows(): Record<string, {
		name: string;
		description: string;
		steps: Array<{
			name: string;
			action: string;
			continueOnError?: boolean;
		}>;
	}> {
		return {
			'code-review': {
				name: 'Code Review',
				description: 'Comprehensive code review workflow',
				steps: [
					{ name: 'syntax-check', action: 'Check code syntax and formatting' },
					{ name: 'logic-review', action: 'Review code logic and efficiency' },
					{ name: 'security-scan', action: 'Identify potential security issues' },
					{ name: 'suggestions', action: 'Provide improvement suggestions' }
				]
			},
			'documentation': {
				name: 'Documentation Generation',
				description: 'Generate comprehensive documentation',
				steps: [
					{ name: 'analyze-structure', action: 'Analyze code structure and components' },
					{ name: 'generate-docs', action: 'Generate detailed documentation' },
					{ name: 'create-examples', action: 'Create usage examples' },
					{ name: 'format-output', action: 'Format documentation for readability' }
				]
			},
			'refactor': {
				name: 'Code Refactoring',
				description: 'Intelligent code refactoring workflow',
				steps: [
					{ name: 'analyze-code', action: 'Analyze current code structure' },
					{ name: 'identify-issues', action: 'Identify refactoring opportunities' },
					{ name: 'propose-changes', action: 'Propose specific refactoring changes' },
					{ name: 'validate-changes', action: 'Validate proposed changes' }
				]
			},
			'test-generation': {
				name: 'Test Generation',
				description: 'Generate comprehensive test suites',
				steps: [
					{ name: 'analyze-functions', action: 'Analyze functions and methods' },
					{ name: 'identify-cases', action: 'Identify test cases and edge cases' },
					{ name: 'generate-tests', action: 'Generate test code' },
					{ name: 'validate-coverage', action: 'Validate test coverage' }
				]
			}
		};
	}

	/**
	 * Execute a single workflow step
	 */
	private async executeWorkflowStep(step: {
		name: string;
		action: string;
		continueOnError?: boolean;
	}, input: string, parameters?: Record<string, any>): Promise<string> {
		let prompt = `${step.action}\n\nInput: ${input}`;

		if (parameters && Object.keys(parameters).length > 0) {
			prompt += `\n\nParameters: ${JSON.stringify(parameters, null, 2)}`;
		}

		return await this.aiService.answerQuestion(prompt);
	}

	/**
	 * Process variables in workflow steps
	 */
	private processVariables(steps: any[], variables: Record<string, any>): any[] {
		return steps.map(step => {
			let processedStep = { ...step };

			Object.entries(variables).forEach(([key, value]) => {
				const placeholder = `{{${key}}}`;
				if (typeof processedStep.action === 'string') {
					processedStep.action = processedStep.action.replace(new RegExp(placeholder, 'g'), String(value));
				}
			});

			return processedStep;
		});
	}

	/**
	 * Format response based on output format
	 */
	private formatResponse(response: string, format: string = 'text'): any {
		switch (format) {
			case 'json':
				try {
					return JSON.parse(response);
				} catch {
					return { response };
				}
			case 'markdown':
				return `\`\`\`markdown\n${response}\n\`\`\``;
			case 'code':
				return `\`\`\`\n${response}\n\`\`\``;
			case 'text':
			default:
				return response;
		}
	}

	/**
	 * Check if error is retryable
	 */
	private shouldRetry(error: any): boolean {
		// Define retryable error conditions
		const retryableErrors = [
			'network error',
			'timeout',
			'rate limit',
			'temporary failure'
		];

		const errorMessage = error.message?.toLowerCase() || '';
		return retryableErrors.some(pattern => errorMessage.includes(pattern));
	}

	/**
	 * Retry request with exponential backoff
	 */
	private async retryRequest(input: string, context: any, maxRetries: number): Promise<any> {
		let lastError;

		for (let attempt = 1; attempt <= maxRetries; attempt++) {
			try {
				// Wait before retry (exponential backoff)
				if (attempt > 1) {
					const delay = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s, etc.
					await new Promise(resolve => setTimeout(resolve, delay));
				}

				this.logService.info(`Retry attempt ${attempt}/${maxRetries}`);

				// Remove retry options to prevent infinite recursion
				const retryContext = { ...context };
				delete retryContext.retryOnFailure;
				delete retryContext.maxRetries;

				return await this.handleRequest(input, retryContext);
			} catch (error) {
				lastError = error;
				this.logService.warn(`Retry attempt ${attempt} failed:`, error);
			}
		}

		throw lastError;
	}
}
