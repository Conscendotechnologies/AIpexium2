/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import '../../platform/update/common/update.config.contribution.js';

import { app, dialog } from 'electron';
import { unlinkSync, promises } from 'fs';
import { URI } from '../../base/common/uri.js';
import { coalesce, distinct } from '../../base/common/arrays.js';
import { Promises } from '../../base/common/async.js';
import { toErrorMessage } from '../../base/common/errorMessage.js';
import { ExpectedError, setUnexpectedErrorHandler } from '../../base/common/errors.js';
import { IPathWithLineAndColumn, isValidBasename, parseLineAndColumnAware, sanitizeFilePath } from '../../base/common/extpath.js';
import { Event } from '../../base/common/event.js';
import { getPathLabel } from '../../base/common/labels.js';
import { Schemas } from '../../base/common/network.js';
import { basename, join, resolve } from '../../base/common/path.js';
import { mark } from '../../base/common/performance.js';
import { IProcessEnvironment, isMacintosh, isWindows, OS } from '../../base/common/platform.js';
import { cwd } from '../../base/common/process.js';
import { rtrim, trim } from '../../base/common/strings.js';
import { Promises as FSPromises } from '../../base/node/pfs.js';
import { ProxyChannel } from '../../base/parts/ipc/common/ipc.js';
import { Client as NodeIPCClient } from '../../base/parts/ipc/common/ipc.net.js';
import { connect as nodeIPCConnect, serve as nodeIPCServe, Server as NodeIPCServer, XDG_RUNTIME_DIR } from '../../base/parts/ipc/node/ipc.net.js';
import { CodeApplication } from './app.js';
import { localize } from '../../nls.js';
import { IConfigurationService } from '../../platform/configuration/common/configuration.js';
import { ConfigurationService } from '../../platform/configuration/common/configurationService.js';
import { IDiagnosticsMainService } from '../../platform/diagnostics/electron-main/diagnosticsMainService.js';
import { DiagnosticsService } from '../../platform/diagnostics/node/diagnosticsService.js';
import { NativeParsedArgs } from '../../platform/environment/common/argv.js';
import { EnvironmentMainService, IEnvironmentMainService } from '../../platform/environment/electron-main/environmentMainService.js';
import { addArg, parseMainProcessArgv } from '../../platform/environment/node/argvHelper.js';
import { createWaitMarkerFileSync } from '../../platform/environment/node/wait.js';
import { IFileService } from '../../platform/files/common/files.js';
import { FileService } from '../../platform/files/common/fileService.js';
import { DiskFileSystemProvider } from '../../platform/files/node/diskFileSystemProvider.js';
import { SyncDescriptor } from '../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../platform/instantiation/common/instantiation.js';
import { InstantiationService } from '../../platform/instantiation/common/instantiationService.js';
import { ServiceCollection } from '../../platform/instantiation/common/serviceCollection.js';
import { ILaunchMainService } from '../../platform/launch/electron-main/launchMainService.js';
import { ILifecycleMainService, LifecycleMainService } from '../../platform/lifecycle/electron-main/lifecycleMainService.js';
import { BufferLogger } from '../../platform/log/common/bufferLog.js';
import { ConsoleMainLogger, getLogLevel, ILoggerService, ILogService } from '../../platform/log/common/log.js';
import product from '../../platform/product/common/product.js';
import { IProductService } from '../../platform/product/common/productService.js';
import { IProtocolMainService } from '../../platform/protocol/electron-main/protocol.js';
import { ProtocolMainService } from '../../platform/protocol/electron-main/protocolMainService.js';
import { ITunnelService } from '../../platform/tunnel/common/tunnel.js';
import { TunnelService } from '../../platform/tunnel/node/tunnelService.js';
import { IRequestService, asText } from '../../platform/request/common/request.js';
import { RequestService } from '../../platform/request/electron-utility/requestService.js';
import { ISignService } from '../../platform/sign/common/sign.js';
import { SignService } from '../../platform/sign/node/signService.js';
import { IStateReadService, IStateService } from '../../platform/state/node/state.js';
import { NullTelemetryService } from '../../platform/telemetry/common/telemetryUtils.js';
import { IThemeMainService } from '../../platform/theme/electron-main/themeMainService.js';
import { IUserDataProfilesMainService, UserDataProfilesMainService } from '../../platform/userDataProfile/electron-main/userDataProfile.js';
import { IPolicyService, NullPolicyService } from '../../platform/policy/common/policy.js';
import { NativePolicyService } from '../../platform/policy/node/nativePolicyService.js';
import { FilePolicyService } from '../../platform/policy/common/filePolicyService.js';
import { DisposableStore } from '../../base/common/lifecycle.js';
import { IUriIdentityService } from '../../platform/uriIdentity/common/uriIdentity.js';
import { UriIdentityService } from '../../platform/uriIdentity/common/uriIdentityService.js';
import { ILoggerMainService, LoggerMainService } from '../../platform/log/electron-main/loggerService.js';
import { LogService } from '../../platform/log/common/logService.js';
import { massageMessageBoxOptions } from '../../platform/dialogs/common/dialogs.js';
import { SaveStrategy, StateService } from '../../platform/state/node/stateService.js';
import { FileUserDataProvider } from '../../platform/userData/common/fileUserDataProvider.js';
import { addUNCHostToAllowlist, getUNCHost } from '../../base/node/unc.js';
import { ThemeMainService } from '../../platform/theme/electron-main/themeMainServiceImpl.js';
import { CancellationToken } from '../../base/common/cancellation.js';
import { VSBuffer } from '../../base/common/buffer.js';
import { ICustomExtensionsConfig, IGithubReleaseConfig, IExtensionDownloadResult, DOWNLOAD_INFO_PATH } from '../../workbench/contrib/customExtensions/common/customExtensions.js';

/**
 * The main VS Code entry point.
 *
 * Note: This class can exist more than once for example when VS Code is already
 * running and a second instance is started from the command line. It will always
 * try to communicate with an existing instance to prevent that 2 VS Code instances
 * are running at the same time.
 */
class CodeMain {

	main(): void {
		try {
			this.startup();
		} catch (error) {
			console.error(error.message);
			app.exit(1);
		}
	}

	//#region test api call

	/**
	 * Makes an API call to the specified endpoint
	 */
	private async makeApiCall(requestService: IRequestService, endpoint: string, method: 'GET' | 'POST' = 'GET', data?: any): Promise<any> {
		try {
			const options: any = {
				type: method,
				url: endpoint,
				headers: {
					'Content-Type': 'application/json',
					'User-Agent': `${product.nameShort}/${product.version}`
				}
			};

			if (method === 'POST' && data) {
				options.data = JSON.stringify(data);
			}

			const response = await requestService.request(options, CancellationToken.None);

			if (response.res.statusCode && response.res.statusCode >= 200 && response.res.statusCode < 300) {
				const responseText = await asText(response);
				return JSON.parse(responseText || '{}');
			} else {
				throw new Error(`API call failed with status: ${response.res.statusCode}`);
			}
		} catch (error) {
			console.error('API call error:', toErrorMessage(error));
			throw error;
		}
	}

	/**
	 * Downloads a file from the given URL and saves it to the specified path
	 */
	private async downloadFile(requestService: IRequestService, fileService: IFileService, downloadUrl: string, targetPath: URI): Promise<void> {
		try {
			const response = await requestService.request({
				type: 'GET',
				url: downloadUrl,
				headers: {
					'User-Agent': `${product.nameShort}/${product.version}`
				}
			}, CancellationToken.None);

			if (response.res.statusCode && response.res.statusCode >= 200 && response.res.statusCode < 300) {
				await fileService.writeFile(targetPath, response.stream);
			} else {
				throw new Error(`Download failed with status: ${response.res.statusCode}`);
			}
		} catch (error) {
			console.error('Download error:', toErrorMessage(error));
			throw error;
		}
	}

	private async startup(): Promise<void> {

		// Set the error handler early enough so that we are not getting the
		// default electron error dialog popping up
		setUnexpectedErrorHandler(err => console.error(err));

		// Create services
		const [instantiationService, instanceEnvironment, environmentMainService, configurationService, stateMainService, bufferLogger, productService, userDataProfilesMainService] = this.createServices();

		try {

			// Init services
			try {
				await this.initServices(environmentMainService, userDataProfilesMainService, configurationService, stateMainService, productService);
			} catch (error) {

				// Show a dialog for errors that can be resolved by the user
				this.handleStartupDataDirError(environmentMainService, productService, error);

				throw error;
			}

			// Startup
			await instantiationService.invokeFunction(async accessor => {
				const logService = accessor.get(ILogService);
				const lifecycleMainService = accessor.get(ILifecycleMainService);
				const fileService = accessor.get(IFileService);
				const loggerService = accessor.get(ILoggerService);
				const requestService = accessor.get(IRequestService);

				// Download custom extensions from product configuration
				try {
					await this.downloadCustomExtensions(requestService, fileService, environmentMainService, productService, logService);
				} catch (error) {
					logService.warn('Failed to download custom extensions:', toErrorMessage(error));
				}

				// Create the main IPC server by trying to be the server
				// If this throws an error it means we are not the first
				// instance of VS Code running and so we would quit.
				const mainProcessNodeIpcServer = await this.claimInstance(logService, environmentMainService, lifecycleMainService, instantiationService, productService, true);

				// Write a lockfile to indicate an instance is running
				// (https://github.com/microsoft/vscode/issues/127861#issuecomment-877417451)
				FSPromises.writeFile(environmentMainService.mainLockfile, String(process.pid)).catch(err => {
					logService.warn(`app#startup(): Error writing main lockfile: ${err.stack}`);
				});

				// Delay creation of spdlog for perf reasons (https://github.com/microsoft/vscode/issues/72906)
				bufferLogger.logger = loggerService.createLogger('main', { name: localize('mainLog', "Main") });

				// Lifecycle
				Event.once(lifecycleMainService.onWillShutdown)(evt => {
					fileService.dispose();
					configurationService.dispose();
					evt.join('instanceLockfile', promises.unlink(environmentMainService.mainLockfile).catch(() => { /* ignored */ }));
				});

				return instantiationService.createInstance(CodeApplication, mainProcessNodeIpcServer, instanceEnvironment).startup();
			});
		} catch (error) {
			instantiationService.invokeFunction(this.quit, error);
		}
	}

	private createServices(): [IInstantiationService, IProcessEnvironment, IEnvironmentMainService, ConfigurationService, StateService, BufferLogger, IProductService, UserDataProfilesMainService] {
		const services = new ServiceCollection();
		const disposables = new DisposableStore();
		process.once('exit', () => disposables.dispose());

		// Product
		const productService = { _serviceBrand: undefined, ...product };
		services.set(IProductService, productService);

		// Environment
		const environmentMainService = new EnvironmentMainService(this.resolveArgs(), productService);
		const instanceEnvironment = this.patchEnvironment(environmentMainService); // Patch `process.env` with the instance's environment
		services.set(IEnvironmentMainService, environmentMainService);

		// Logger
		const loggerService = new LoggerMainService(getLogLevel(environmentMainService), environmentMainService.logsHome);
		services.set(ILoggerMainService, loggerService);

		// Log: We need to buffer the spdlog logs until we are sure
		// we are the only instance running, otherwise we'll have concurrent
		// log file access on Windows (https://github.com/microsoft/vscode/issues/41218)
		const bufferLogger = new BufferLogger(loggerService.getLogLevel());
		const logService = disposables.add(new LogService(bufferLogger, [new ConsoleMainLogger(loggerService.getLogLevel())]));
		services.set(ILogService, logService);

		// Files
		const fileService = new FileService(logService);
		services.set(IFileService, fileService);
		const diskFileSystemProvider = new DiskFileSystemProvider(logService);
		fileService.registerProvider(Schemas.file, diskFileSystemProvider);

		// URI Identity
		const uriIdentityService = new UriIdentityService(fileService);
		services.set(IUriIdentityService, uriIdentityService);

		// State
		const stateService = new StateService(SaveStrategy.DELAYED, environmentMainService, logService, fileService);
		services.set(IStateReadService, stateService);
		services.set(IStateService, stateService);

		// User Data Profiles
		const userDataProfilesMainService = new UserDataProfilesMainService(stateService, uriIdentityService, environmentMainService, fileService, logService);
		services.set(IUserDataProfilesMainService, userDataProfilesMainService);

		// Use FileUserDataProvider for user data to
		// enable atomic read / write operations.
		fileService.registerProvider(Schemas.vscodeUserData, new FileUserDataProvider(Schemas.file, diskFileSystemProvider, Schemas.vscodeUserData, userDataProfilesMainService, uriIdentityService, logService));

		// Policy
		let policyService: IPolicyService | undefined;
		if (isWindows && productService.win32RegValueName) {
			policyService = disposables.add(new NativePolicyService(logService, productService.win32RegValueName));
		} else if (isMacintosh && productService.darwinBundleIdentifier) {
			policyService = disposables.add(new NativePolicyService(logService, productService.darwinBundleIdentifier));
		} else if (environmentMainService.policyFile) {
			policyService = disposables.add(new FilePolicyService(environmentMainService.policyFile, fileService, logService));
		} else {
			policyService = new NullPolicyService();
		}
		services.set(IPolicyService, policyService);

		// Configuration
		const configurationService = new ConfigurationService(userDataProfilesMainService.defaultProfile.settingsResource, fileService, policyService, logService);
		services.set(IConfigurationService, configurationService);

		// Lifecycle
		services.set(ILifecycleMainService, new SyncDescriptor(LifecycleMainService, undefined, false));

		// Request
		services.set(IRequestService, new SyncDescriptor(RequestService, undefined, true));

		// Themes
		services.set(IThemeMainService, new SyncDescriptor(ThemeMainService));

		// Signing
		services.set(ISignService, new SyncDescriptor(SignService, undefined, false /* proxied to other processes */));

		// Tunnel
		services.set(ITunnelService, new SyncDescriptor(TunnelService));

		// Protocol (instantiated early and not using sync descriptor for security reasons)
		services.set(IProtocolMainService, new ProtocolMainService(environmentMainService, userDataProfilesMainService, logService));

		return [new InstantiationService(services, true), instanceEnvironment, environmentMainService, configurationService, stateService, bufferLogger, productService, userDataProfilesMainService];
	}

	private patchEnvironment(environmentMainService: IEnvironmentMainService): IProcessEnvironment {
		const instanceEnvironment: IProcessEnvironment = {
			VSCODE_IPC_HOOK: environmentMainService.mainIPCHandle
		};

		['VSCODE_NLS_CONFIG', 'VSCODE_PORTABLE'].forEach(key => {
			const value = process.env[key];
			if (typeof value === 'string') {
				instanceEnvironment[key] = value;
			}
		});

		Object.assign(process.env, instanceEnvironment);

		return instanceEnvironment;
	}

	private async initServices(environmentMainService: IEnvironmentMainService, userDataProfilesMainService: UserDataProfilesMainService, configurationService: ConfigurationService, stateService: StateService, productService: IProductService): Promise<void> {
		await Promises.settled<unknown>([

			// Environment service (paths)
			Promise.all<string | undefined>([
				this.allowWindowsUNCPath(environmentMainService.extensionsPath), // enable extension paths on UNC drives...
				environmentMainService.codeCachePath,							 // ...other user-data-derived paths should already be enlisted from `main.js`
				environmentMainService.logsHome.with({ scheme: Schemas.file }).fsPath,
				userDataProfilesMainService.defaultProfile.globalStorageHome.with({ scheme: Schemas.file }).fsPath,
				environmentMainService.workspaceStorageHome.with({ scheme: Schemas.file }).fsPath,
				environmentMainService.localHistoryHome.with({ scheme: Schemas.file }).fsPath,
				environmentMainService.backupHome
			].map(path => path ? promises.mkdir(path, { recursive: true }) : undefined)),

			// State service
			stateService.init(),

			// Configuration service
			configurationService.initialize()
		]);

		// Initialize user data profiles after initializing the state
		userDataProfilesMainService.init();
	}

	private allowWindowsUNCPath(path: string): string {
		if (isWindows) {
			const host = getUNCHost(path);
			if (host) {
				addUNCHostToAllowlist(host);
			}
		}

		return path;
	}

	private async claimInstance(logService: ILogService, environmentMainService: IEnvironmentMainService, lifecycleMainService: ILifecycleMainService, instantiationService: IInstantiationService, productService: IProductService, retry: boolean): Promise<NodeIPCServer> {

		// Try to setup a server for running. If that succeeds it means
		// we are the first instance to startup. Otherwise it is likely
		// that another instance is already running.
		let mainProcessNodeIpcServer: NodeIPCServer;
		try {
			mark('code/willStartMainServer');
			mainProcessNodeIpcServer = await nodeIPCServe(environmentMainService.mainIPCHandle);
			mark('code/didStartMainServer');
			Event.once(lifecycleMainService.onWillShutdown)(() => mainProcessNodeIpcServer.dispose());
		} catch (error) {

			// Handle unexpected errors (the only expected error is EADDRINUSE that
			// indicates another instance of VS Code is running)
			if (error.code !== 'EADDRINUSE') {

				// Show a dialog for errors that can be resolved by the user
				this.handleStartupDataDirError(environmentMainService, productService, error);

				// Any other runtime error is just printed to the console
				throw error;
			}

			// 🔥 LOG: Another instance detected
			logService.info('🔥 SIID SINGLE INSTANCE: Another instance is running, attempting to connect...');
			logService.info('🔥 SIID ARGS: Process arguments:', JSON.stringify(process.argv));
			logService.info('🔥 SIID ENV ARGS: Environment args:', JSON.stringify(environmentMainService.args));

			// there's a running instance, let's connect to it
			let client: NodeIPCClient<string>;
			try {
				client = await nodeIPCConnect(environmentMainService.mainIPCHandle, 'main');
			} catch (error) {

				// Handle unexpected connection errors by showing a dialog to the user
				if (!retry || isWindows || error.code !== 'ECONNREFUSED') {
					if (error.code === 'EPERM') {
						this.showStartupWarningDialog(
							localize('secondInstanceAdmin', "Another instance of {0} is already running as administrator.", productService.nameShort),
							localize('secondInstanceAdminDetail', "Please close the other instance and try again."),
							productService
						);
					}

					throw error;
				}

				// it happens on Linux and OS X that the pipe is left behind
				// let's delete it, since we can't connect to it and then
				// retry the whole thing
				try {
					unlinkSync(environmentMainService.mainIPCHandle);
				} catch (error) {
					logService.warn('Could not delete obsolete instance handle', error);

					throw error;
				}

				return this.claimInstance(logService, environmentMainService, lifecycleMainService, instantiationService, productService, false);
			}

			// Tests from CLI require to be the only instance currently
			if (environmentMainService.extensionTestsLocationURI && !environmentMainService.debugExtensionHost.break) {
				const msg = `Running extension tests from the command line is currently only supported if no other instance of ${productService.nameShort} is running.`;
				logService.error(msg);
				client.dispose();

				throw new Error(msg);
			}

			// Show a warning dialog after some timeout if it takes long to talk to the other instance
			// Skip this if we are running with --wait where it is expected that we wait for a while.
			// Also skip when gathering diagnostics (--status) which can take a longer time.
			let startupWarningDialogHandle: Timeout | undefined = undefined;
			if (!environmentMainService.args.wait && !environmentMainService.args.status) {
				startupWarningDialogHandle = setTimeout(() => {
					this.showStartupWarningDialog(
						localize('secondInstanceNoResponse', "Another instance of {0} is running but not responding", productService.nameShort),
						localize('secondInstanceNoResponseDetail', "Please close all other instances and try again."),
						productService
					);
				}, 10000);
			}

			const otherInstanceLaunchMainService = ProxyChannel.toService<ILaunchMainService>(client.getChannel('launch'), { disableMarshalling: true });
			const otherInstanceDiagnosticsMainService = ProxyChannel.toService<IDiagnosticsMainService>(client.getChannel('diagnostics'), { disableMarshalling: true });

			// Process Info
			if (environmentMainService.args.status) {
				return instantiationService.invokeFunction(async () => {
					const diagnosticsService = new DiagnosticsService(NullTelemetryService, productService);
					const mainDiagnostics = await otherInstanceDiagnosticsMainService.getMainDiagnostics();
					const remoteDiagnostics = await otherInstanceDiagnosticsMainService.getRemoteDiagnostics({ includeProcesses: true, includeWorkspaceMetadata: true });
					const diagnostics = await diagnosticsService.getDiagnostics(mainDiagnostics, remoteDiagnostics);
					console.log(diagnostics);

					throw new ExpectedError();
				});
			}

			// Windows: allow to set foreground
			if (isWindows) {
				await this.windowsAllowSetForegroundWindow(otherInstanceLaunchMainService, logService);
			}

			// Send environment over...
			logService.trace('Sending env to running instance...');
			logService.info('🔥 SIID SENDING ARGS: About to send args to existing instance:', JSON.stringify(environmentMainService.args));
			await otherInstanceLaunchMainService.start(environmentMainService.args, process.env as IProcessEnvironment);
			logService.info('🔥 SIID SENT ARGS: Successfully sent args to existing instance, now terminating new instance');

			// Cleanup
			client.dispose();

			// Now that we started, make sure the warning dialog is prevented
			if (startupWarningDialogHandle) {
				clearTimeout(startupWarningDialogHandle);
			}

			throw new ExpectedError('Sent env to running instance. Terminating...');
		}

		// Print --status usage info
		if (environmentMainService.args.status) {
			console.log(localize('statusWarning', "Warning: The --status argument can only be used if {0} is already running. Please run it again after {0} has started.", productService.nameShort));

			throw new ExpectedError('Terminating...');
		}

		// Set the VSCODE_PID variable here when we are sure we are the first
		// instance to startup. Otherwise we would wrongly overwrite the PID
		process.env['VSCODE_PID'] = String(process.pid);

		return mainProcessNodeIpcServer;
	}

	private handleStartupDataDirError(environmentMainService: IEnvironmentMainService, productService: IProductService, error: NodeJS.ErrnoException): void {
		if (error.code === 'EACCES' || error.code === 'EPERM') {
			const directories = coalesce([environmentMainService.userDataPath, environmentMainService.extensionsPath, XDG_RUNTIME_DIR]).map(folder => getPathLabel(URI.file(folder), { os: OS, tildify: environmentMainService }));

			this.showStartupWarningDialog(
				localize('startupDataDirError', "Unable to write program user data."),
				localize('startupUserDataAndExtensionsDirErrorDetail', "{0}\n\nPlease make sure the following directories are writeable:\n\n{1}", toErrorMessage(error), directories.join('\n')),
				productService
			);
		}
	}

	private showStartupWarningDialog(message: string, detail: string, productService: IProductService): void {

		// use sync variant here because we likely exit after this method
		// due to startup issues and otherwise the dialog seems to disappear
		// https://github.com/microsoft/vscode/issues/104493

		dialog.showMessageBoxSync(massageMessageBoxOptions({
			type: 'warning',
			buttons: [localize({ key: 'close', comment: ['&& denotes a mnemonic'] }, "&&Close")],
			message,
			detail
		}, productService).options);
	}

	private async windowsAllowSetForegroundWindow(launchMainService: ILaunchMainService, logService: ILogService): Promise<void> {
		if (isWindows) {
			const processId = await launchMainService.getMainProcessId();

			logService.trace('Sending some foreground love to the running instance:', processId);

			try {
				(await import('windows-foreground-love')).allowSetForegroundWindow(processId);
			} catch (error) {
				logService.error(error);
			}
		}
	}

	private quit(accessor: ServicesAccessor, reason?: ExpectedError | Error): void {
		const logService = accessor.get(ILogService);
		const lifecycleMainService = accessor.get(ILifecycleMainService);

		let exitCode = 0;

		if (reason) {
			if ((reason as ExpectedError).isExpected) {
				if (reason.message) {
					logService.trace(reason.message);
				}
			} else {
				exitCode = 1; // signal error to the outside

				if (reason.stack) {
					logService.error(reason.stack);
				} else {
					logService.error(`Startup error: ${reason.toString()}`);
				}
			}
		}

		lifecycleMainService.kill(exitCode);
	}

	//#region Command line arguments utilities

	private resolveArgs(): NativeParsedArgs {

		// Parse arguments
		const args = this.validatePaths(parseMainProcessArgv(process.argv));

		// If we are started with --wait create a random temporary file
		// and pass it over to the starting instance. We can use this file
		// to wait for it to be deleted to monitor that the edited file
		// is closed and then exit the waiting process.
		//
		// Note: we are not doing this if the wait marker has been already
		// added as argument. This can happen if VS Code was started from CLI.

		if (args.wait && !args.waitMarkerFilePath) {
			const waitMarkerFilePath = createWaitMarkerFileSync(args.verbose);
			if (waitMarkerFilePath) {
				addArg(process.argv, '--waitMarkerFilePath', waitMarkerFilePath);
				args.waitMarkerFilePath = waitMarkerFilePath;
			}
		}

		return args;
	}

	private validatePaths(args: NativeParsedArgs): NativeParsedArgs {

		// Track URLs if they're going to be used
		if (args['open-url']) {
			args._urls = args._;
			args._ = [];
		}

		// Normalize paths and watch out for goto line mode
		if (!args['remote']) {
			const paths = this.doValidatePaths(args._, args.goto);
			args._ = paths;
		}

		return args;
	}

	private doValidatePaths(args: string[], gotoLineMode?: boolean): string[] {
		const currentWorkingDir = cwd();
		const result = args.map(arg => {
			let pathCandidate = String(arg);

			let parsedPath: IPathWithLineAndColumn | undefined = undefined;
			if (gotoLineMode) {
				parsedPath = parseLineAndColumnAware(pathCandidate);
				pathCandidate = parsedPath.path;
			}

			if (pathCandidate) {
				pathCandidate = this.preparePath(currentWorkingDir, pathCandidate);
			}

			const sanitizedFilePath = sanitizeFilePath(pathCandidate, currentWorkingDir);

			const filePathBasename = basename(sanitizedFilePath);
			if (filePathBasename /* can be empty if code is opened on root */ && !isValidBasename(filePathBasename)) {
				return null; // do not allow invalid file names
			}

			if (gotoLineMode && parsedPath) {
				parsedPath.path = sanitizedFilePath;

				return this.toPath(parsedPath);
			}

			return sanitizedFilePath;
		});

		const caseInsensitive = isWindows || isMacintosh;
		const distinctPaths = distinct(result, path => path && caseInsensitive ? path.toLowerCase() : (path || ''));

		return coalesce(distinctPaths);
	}

	private preparePath(cwd: string, path: string): string {

		// Trim trailing quotes
		if (isWindows) {
			path = rtrim(path, '"'); // https://github.com/microsoft/vscode/issues/1498
		}

		// Trim whitespaces
		path = trim(trim(path, ' '), '\t');

		if (isWindows) {

			// Resolve the path against cwd if it is relative
			path = resolve(cwd, path);

			// Trim trailing '.' chars on Windows to prevent invalid file names
			path = rtrim(path, '.');
		}

		return path;
	}

	private toPath(pathWithLineAndCol: IPathWithLineAndColumn): string {
		const segments = [pathWithLineAndCol.path];

		if (typeof pathWithLineAndCol.line === 'number') {
			segments.push(String(pathWithLineAndCol.line));
		}

		if (typeof pathWithLineAndCol.column === 'number') {
			segments.push(String(pathWithLineAndCol.column));
		}

		return segments.join(':');
	}

	//#endregion

	/**
	 * Downloads custom extensions from GitHub releases based on product configuration
	 */
	private async downloadCustomExtensions(
		requestService: IRequestService,
		fileService: IFileService,
		environmentMainService: IEnvironmentMainService,
		productService: IProductService,
		logService: ILogService
	): Promise<void> {
		try {
			// Get custom extensions configuration from product.json
			const customExtensions = (productService as any).customExtensions as ICustomExtensionsConfig;
			if (!customExtensions || !customExtensions.githubReleases || customExtensions.githubReleases.length === 0) {
				logService.info('No custom extensions configured for download');
				return;
			}

			logService.info(`Found ${customExtensions.githubReleases.length} custom extensions to download`);

			// Create downloads folder
			const downloadsPath = URI.joinPath(URI.file(environmentMainService.userDataPath), 'User', 'downloads');
			try {
				await fileService.createFolder(downloadsPath);
			} catch (error) {
				logService.trace('Downloads folder creation:', toErrorMessage(error));
			}

			const downloadResults: IExtensionDownloadResult[] = [];

			// Download each extension
			for (const extensionConfig of customExtensions.githubReleases) {
				try {
					const result = await this.downloadExtensionFromGitHub(
						requestService,
						fileService,
						downloadsPath,
						extensionConfig,
						logService
					);
					downloadResults.push(result);
				} catch (error) {
					logService.error(`Failed to download extension ${extensionConfig.extensionId}:`, toErrorMessage(error));
					downloadResults.push({
						extensionId: extensionConfig.extensionId,
						fileName: '',
						filePath: '',
						version: '',
						success: false,
						error: toErrorMessage(error)
					});
				}
			}

			// Save download results for the extension installer
			// Use the exact same path structure that the workbench expects (vscode-userdata scheme)
			// The workbench looks for: userRoamingDataHome + DOWNLOAD_INFO_PATH
			// Which translates to: userDataPath/User + downloads/extensions-download-info.json
			const downloadInfoPath = join(environmentMainService.userDataPath, 'User', DOWNLOAD_INFO_PATH);
			logService.info(`Saving downloads to ${downloadsPath}`);
			logService.info(`Saving download info to ${downloadInfoPath}`);
			const downloadInfo = {
				downloadedAt: Date.now(),
				results: downloadResults
			};

			await fileService.writeFile(URI.file(downloadInfoPath), VSBuffer.fromString(JSON.stringify(downloadInfo, null, '\t')));
			logService.info(`Download info saved for ${downloadResults.length} extensions`);

			// Debug: Check what files are actually in the downloads directory
			try {
				const downloadsDirectoryContents = await fileService.resolve(downloadsPath);
				if (downloadsDirectoryContents.children) {
					const fileList = downloadsDirectoryContents.children.map(child => ({
						name: child.name,
						type: child.isDirectory ? 'directory' : 'file',
						size: child.size || 0
					}));
					logService.info(`Downloads directory contents: ${JSON.stringify(fileList, null, 2)}`);
				} else {
					logService.info('Downloads directory appears to be empty');
				}
			} catch (debugError) {
				logService.error('Error reading downloads directory:', toErrorMessage(debugError));
			}

			// Debug: Check if the download info file was actually created
			try {
				const downloadInfoFileExists = await fileService.exists(URI.file(downloadInfoPath));
				logService.info(`Download info file exists: ${downloadInfoFileExists}`);

				if (downloadInfoFileExists) {
					const downloadInfoContent = await fileService.readFile(URI.file(downloadInfoPath));
					logService.info(`Download info file content: ${downloadInfoContent.value.toString()}`);
				}
			} catch (debugError) {
				logService.error('Error checking download info file:', toErrorMessage(debugError));
			}

		} catch (error) {
			logService.error('Error downloading custom extensions:', toErrorMessage(error));
		}
	}

	/**
	 * Downloads a single extension from GitHub releases
	 */
	private async downloadExtensionFromGitHub(
		requestService: IRequestService,
		fileService: IFileService,
		downloadsPath: URI,
		extensionConfig: IGithubReleaseConfig,
		logService: ILogService
	): Promise<IExtensionDownloadResult> {
		const apiUrl = `https://api.github.com/repos/${extensionConfig.owner}/${extensionConfig.repo}/releases/latest`;

		logService.info(`Fetching latest release for ${extensionConfig.extensionId} from ${apiUrl}`);

		const apiResponse = await this.makeApiCall(requestService, apiUrl);
		const version = apiResponse.tag_name;

		logService.info(`Latest release version: ${version}`);

		// Find matching asset
		const assets = apiResponse.assets || [];
		let matchingAsset = null;

		// First try exact match
		matchingAsset = assets.find((asset: any) => asset.name === extensionConfig.vsixAssetName);

		// If no exact match and asset name contains wildcard, try pattern matching
		if (!matchingAsset && extensionConfig.vsixAssetName.includes('*')) {
			const pattern = extensionConfig.vsixAssetName.replace(/\*/g, '.*');
			const regex = new RegExp(`^${pattern}$`);
			matchingAsset = assets.find((asset: any) => regex.test(asset.name));
		}

		if (!matchingAsset) {
			throw new Error(`No matching asset found for pattern: ${extensionConfig.vsixAssetName}`);
		}

		const fileName = matchingAsset.name;
		const downloadUrl = matchingAsset.browser_download_url;
		const targetFilePath = URI.joinPath(downloadsPath, fileName);

		logService.info(`Downloading ${fileName} from ${downloadUrl}`);

		await this.downloadFile(requestService, fileService, downloadUrl, targetFilePath);

		logService.info(`Successfully downloaded ${fileName}`);

		return {
			extensionId: extensionConfig.extensionId,
			fileName,
			filePath: targetFilePath.toString(),
			version,
			success: true
		};
	}

	//#endregion
}

// Main Startup
const code = new CodeMain();
code.main();
