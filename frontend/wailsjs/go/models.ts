export namespace core {
	
	export class AppStatus {
	    name: string;
	    version: string;
	    milestone: string;
	    vaultLocked: boolean;
	    vaultInitialized: boolean;
	    passwordless: boolean;
	    quickUnlockReady: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AppStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.milestone = source["milestone"];
	        this.vaultLocked = source["vaultLocked"];
	        this.vaultInitialized = source["vaultInitialized"];
	        this.passwordless = source["passwordless"];
	        this.quickUnlockReady = source["quickUnlockReady"];
	    }
	}
	export class QuickConnectTarget {
	    user: string;
	    address: string;
	    port: number;
	    display: string;
	
	    static createFrom(source: any = {}) {
	        return new QuickConnectTarget(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.user = source["user"];
	        this.address = source["address"];
	        this.port = source["port"];
	        this.display = source["display"];
	    }
	}
	export class HostSummary {
	    id: string;
	    label: string;
	    address: string;
	    effectivePort: number;
	    effectiveUser: string;
	    initialDir?: string;
	    keepaliveSecs: number;
	    groupId: string;
	    identityId: string;
	    tags: string[];
	    jumpChain: string[];
	    proxyProfileId?: string;
	    proxyCommand?: string;
	    color: string;
	    favorite: boolean;
	    sessionLogging: boolean;
	
	    static createFrom(source: any = {}) {
	        return new HostSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.address = source["address"];
	        this.effectivePort = source["effectivePort"];
	        this.effectiveUser = source["effectiveUser"];
	        this.initialDir = source["initialDir"];
	        this.keepaliveSecs = source["keepaliveSecs"];
	        this.groupId = source["groupId"];
	        this.identityId = source["identityId"];
	        this.tags = source["tags"];
	        this.jumpChain = source["jumpChain"];
	        this.proxyProfileId = source["proxyProfileId"];
	        this.proxyCommand = source["proxyCommand"];
	        this.color = source["color"];
	        this.favorite = source["favorite"];
	        this.sessionLogging = source["sessionLogging"];
	    }
	}
	export class HostSearchResult {
	    host: HostSummary;
	    score: number;
	    matchedFields: string[];
	
	    static createFrom(source: any = {}) {
	        return new HostSearchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = this.convertValues(source["host"], HostSummary);
	        this.score = source["score"];
	        this.matchedFields = source["matchedFields"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class CommandPaletteResponse {
	    query: string;
	    hostResults: HostSearchResult[];
	    quickConnect?: QuickConnectTarget;
	
	    static createFrom(source: any = {}) {
	        return new CommandPaletteResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.query = source["query"];
	        this.hostResults = this.convertValues(source["hostResults"], HostSearchResult);
	        this.quickConnect = this.convertValues(source["quickConnect"], QuickConnectTarget);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TerminalSize {
	    cols: number;
	    rows: number;
	
	    static createFrom(source: any = {}) {
	        return new TerminalSize(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.cols = source["cols"];
	        this.rows = source["rows"];
	    }
	}
	export class ConnectRequest {
	    address: string;
	    port: number;
	    username: string;
	    password: string;
	    keyId?: string;
	    privateKey: string;
	    passphrase: string;
	    useAgent?: boolean;
	    proxyProfileId?: string;
	    proxyJump?: string;
	    proxyCommand?: string;
	    size: TerminalSize;
	
	    static createFrom(source: any = {}) {
	        return new ConnectRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.address = source["address"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.password = source["password"];
	        this.keyId = source["keyId"];
	        this.privateKey = source["privateKey"];
	        this.passphrase = source["passphrase"];
	        this.useAgent = source["useAgent"];
	        this.proxyProfileId = source["proxyProfileId"];
	        this.proxyJump = source["proxyJump"];
	        this.proxyCommand = source["proxyCommand"];
	        this.size = this.convertValues(source["size"], TerminalSize);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class FileItem {
	    name: string;
	    path: string;
	    size: number;
	    isDir: boolean;
	    modTime: number;
	    permissions: string;
	
	    static createFrom(source: any = {}) {
	        return new FileItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.path = source["path"];
	        this.size = source["size"];
	        this.isDir = source["isDir"];
	        this.modTime = source["modTime"];
	        this.permissions = source["permissions"];
	    }
	}
	export class ForwardRule {
	    id: string;
	    hostId?: string;
	    type: string;
	    bindAddress: string;
	    bindPort: number;
	    targetHost?: string;
	    targetPort?: number;
	    autoStart: boolean;
	    label?: string;
	
	    static createFrom(source: any = {}) {
	        return new ForwardRule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.hostId = source["hostId"];
	        this.type = source["type"];
	        this.bindAddress = source["bindAddress"];
	        this.bindPort = source["bindPort"];
	        this.targetHost = source["targetHost"];
	        this.targetPort = source["targetPort"];
	        this.autoStart = source["autoStart"];
	        this.label = source["label"];
	    }
	}
	export class ForwardTunnelStatus {
	    id: string;
	    ruleId: string;
	    sessionId: string;
	    hostId?: string;
	    type: string;
	    bindAddress: string;
	    bindPort: number;
	    targetHost?: string;
	    targetPort?: number;
	    status: string;
	    bytesIn: number;
	    bytesOut: number;
	    activeConns: number;
	    errorMessage?: string;
	
	    static createFrom(source: any = {}) {
	        return new ForwardTunnelStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.ruleId = source["ruleId"];
	        this.sessionId = source["sessionId"];
	        this.hostId = source["hostId"];
	        this.type = source["type"];
	        this.bindAddress = source["bindAddress"];
	        this.bindPort = source["bindPort"];
	        this.targetHost = source["targetHost"];
	        this.targetPort = source["targetPort"];
	        this.status = source["status"];
	        this.bytesIn = source["bytesIn"];
	        this.bytesOut = source["bytesOut"];
	        this.activeConns = source["activeConns"];
	        this.errorMessage = source["errorMessage"];
	    }
	}
	export class GroupDefaults {
	    port?: number;
	    username?: string;
	    identityId?: string;
	    initialDir?: string;
	    keepaliveSecs?: number;
	    proxyProfileId?: string;
	    sessionLogging?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new GroupDefaults(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.port = source["port"];
	        this.username = source["username"];
	        this.identityId = source["identityId"];
	        this.initialDir = source["initialDir"];
	        this.keepaliveSecs = source["keepaliveSecs"];
	        this.proxyProfileId = source["proxyProfileId"];
	        this.sessionLogging = source["sessionLogging"];
	    }
	}
	export class GroupRecord {
	    id: string;
	    name: string;
	    parentId?: string;
	    defaultSettings: GroupDefaults;
	
	    static createFrom(source: any = {}) {
	        return new GroupRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.parentId = source["parentId"];
	        this.defaultSettings = this.convertValues(source["defaultSettings"], GroupDefaults);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class HostRecord {
	    id: string;
	    label: string;
	    address: string;
	    port: number;
	    groupId?: string;
	    identityId?: string;
	    initialDir?: string;
	    tags?: string[];
	    color?: string;
	    favorite?: boolean;
	    jumpChain?: string[];
	    forwardRuleIds?: string[];
	    proxyProfileId?: string;
	    proxyCommand?: string;
	    sessionLogging?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new HostRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.address = source["address"];
	        this.port = source["port"];
	        this.groupId = source["groupId"];
	        this.identityId = source["identityId"];
	        this.initialDir = source["initialDir"];
	        this.tags = source["tags"];
	        this.color = source["color"];
	        this.favorite = source["favorite"];
	        this.jumpChain = source["jumpChain"];
	        this.forwardRuleIds = source["forwardRuleIds"];
	        this.proxyProfileId = source["proxyProfileId"];
	        this.proxyCommand = source["proxyCommand"];
	        this.sessionLogging = source["sessionLogging"];
	    }
	}
	
	
	export class IdentityRecord {
	    id: string;
	    label: string;
	    username: string;
	    authMethod: string;
	    password?: string;
	    keyId?: string;
	    totpId?: string;
	
	    static createFrom(source: any = {}) {
	        return new IdentityRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.username = source["username"];
	        this.authMethod = source["authMethod"];
	        this.password = source["password"];
	        this.keyId = source["keyId"];
	        this.totpId = source["totpId"];
	    }
	}
	export class IdentitySummary {
	    id: string;
	    label: string;
	    username: string;
	    authMethod: string;
	    keyId?: string;
	    totpId?: string;
	
	    static createFrom(source: any = {}) {
	        return new IdentitySummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.username = source["username"];
	        this.authMethod = source["authMethod"];
	        this.keyId = source["keyId"];
	        this.totpId = source["totpId"];
	    }
	}
	export class NotePage {
	    id: string;
	    hostId?: string;
	    parentId?: string;
	    isFolder: boolean;
	    title: string;
	    type: string;
	    body: string;
	    order: number;
	    // Go type: time
	    createdAt: any;
	    // Go type: time
	    updatedAt: any;
	
	    static createFrom(source: any = {}) {
	        return new NotePage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.hostId = source["hostId"];
	        this.parentId = source["parentId"];
	        this.isFolder = source["isFolder"];
	        this.title = source["title"];
	        this.type = source["type"];
	        this.body = source["body"];
	        this.order = source["order"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class NotePageSummary {
	    id: string;
	    hostId?: string;
	    parentId?: string;
	    isFolder: boolean;
	    title: string;
	    type: string;
	    order: number;
	    snippet?: string;
	    // Go type: time
	    createdAt: any;
	    // Go type: time
	    updatedAt: any;
	
	    static createFrom(source: any = {}) {
	        return new NotePageSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.hostId = source["hostId"];
	        this.parentId = source["parentId"];
	        this.isFolder = source["isFolder"];
	        this.title = source["title"];
	        this.type = source["type"];
	        this.order = source["order"];
	        this.snippet = source["snippet"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class NoteSearchResult {
	    note: NotePageSummary;
	    matchSnippet: string;
	    matchCount: number;
	
	    static createFrom(source: any = {}) {
	        return new NoteSearchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.note = this.convertValues(source["note"], NotePageSummary);
	        this.matchSnippet = source["matchSnippet"];
	        this.matchCount = source["matchCount"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ProxyProfile {
	    id: string;
	    name: string;
	    type: string;
	    jumpHostIds?: string[];
	    command?: string;
	    socksAddress?: string;
	    socksUsername?: string;
	    socksPassword?: string;
	
	    static createFrom(source: any = {}) {
	        return new ProxyProfile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.type = source["type"];
	        this.jumpHostIds = source["jumpHostIds"];
	        this.command = source["command"];
	        this.socksAddress = source["socksAddress"];
	        this.socksUsername = source["socksUsername"];
	        this.socksPassword = source["socksPassword"];
	    }
	}
	export class ProxyProfileSummary {
	    id: string;
	    name: string;
	    type: string;
	    jumpHostIds?: string[];
	    command?: string;
	    socksAddress?: string;
	    socksUsername?: string;
	    hasPassword?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ProxyProfileSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.type = source["type"];
	        this.jumpHostIds = source["jumpHostIds"];
	        this.command = source["command"];
	        this.socksAddress = source["socksAddress"];
	        this.socksUsername = source["socksUsername"];
	        this.hasPassword = source["hasPassword"];
	    }
	}
	export class ProxychainsProxyEntry {
	    type: string;
	    host: string;
	    port: number;
	    username?: string;
	    password?: string;
	    comment?: string;
	
	    static createFrom(source: any = {}) {
	        return new ProxychainsProxyEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.host = source["host"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.password = source["password"];
	        this.comment = source["comment"];
	    }
	}
	export class ProxychainsExportOptions {
	    chainType: string;
	    proxyDNS: boolean;
	    quietMode: boolean;
	    tcpReadTimeout: number;
	    tcpConnectTimeout: number;
	    proxies: ProxychainsProxyEntry[];
	
	    static createFrom(source: any = {}) {
	        return new ProxychainsExportOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.chainType = source["chainType"];
	        this.proxyDNS = source["proxyDNS"];
	        this.quietMode = source["quietMode"];
	        this.tcpReadTimeout = source["tcpReadTimeout"];
	        this.tcpConnectTimeout = source["tcpConnectTimeout"];
	        this.proxies = this.convertValues(source["proxies"], ProxychainsProxyEntry);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class SSHConfigHostEntry {
	    hostAlias: string;
	    hostName: string;
	    user: string;
	    port: number;
	    identityFile: string;
	    proxyJump: string[];
	    proxyCommand?: string;
	
	    static createFrom(source: any = {}) {
	        return new SSHConfigHostEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hostAlias = source["hostAlias"];
	        this.hostName = source["hostName"];
	        this.user = source["user"];
	        this.port = source["port"];
	        this.identityFile = source["identityFile"];
	        this.proxyJump = source["proxyJump"];
	        this.proxyCommand = source["proxyCommand"];
	    }
	}
	export class SSHConfigParseResult {
	    entries: SSHConfigHostEntry[];
	    warnings: string[];
	
	    static createFrom(source: any = {}) {
	        return new SSHConfigParseResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entries = this.convertValues(source["entries"], SSHConfigHostEntry);
	        this.warnings = source["warnings"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SerialAutoDetectResult {
	    port: string;
	    baudRate: number;
	    confidence: string;
	    detected: boolean;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new SerialAutoDetectResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.port = source["port"];
	        this.baudRate = source["baudRate"];
	        this.confidence = source["confidence"];
	        this.detected = source["detected"];
	        this.message = source["message"];
	    }
	}
	export class SerialConfig {
	    port: string;
	    baudRate: number;
	    dataBits: number;
	    parity: string;
	    stopBits: string;
	    flowControl: string;
	    dtr: boolean;
	    rts: boolean;
	    localEcho: boolean;
	    lineEnding: string;
	
	    static createFrom(source: any = {}) {
	        return new SerialConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.port = source["port"];
	        this.baudRate = source["baudRate"];
	        this.dataBits = source["dataBits"];
	        this.parity = source["parity"];
	        this.stopBits = source["stopBits"];
	        this.flowControl = source["flowControl"];
	        this.dtr = source["dtr"];
	        this.rts = source["rts"];
	        this.localEcho = source["localEcho"];
	        this.lineEnding = source["lineEnding"];
	    }
	}
	export class SerialPortInfo {
	    port: string;
	    description: string;
	    manufacturer: string;
	    hardwareId: string;
	    deviceType: string;
	    isUsb: boolean;
	    isConnected: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SerialPortInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.port = source["port"];
	        this.description = source["description"];
	        this.manufacturer = source["manufacturer"];
	        this.hardwareId = source["hardwareId"];
	        this.deviceType = source["deviceType"];
	        this.isUsb = source["isUsb"];
	        this.isConnected = source["isConnected"];
	    }
	}
	export class SessionLogRecord {
	    id: string;
	    sessionId: string;
	    hostId?: string;
	    hostLabel: string;
	    startedAt: string;
	    endedAt?: string;
	    filePath: string;
	    byteCount: number;
	    lineCount: number;
	    active: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SessionLogRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sessionId = source["sessionId"];
	        this.hostId = source["hostId"];
	        this.hostLabel = source["hostLabel"];
	        this.startedAt = source["startedAt"];
	        this.endedAt = source["endedAt"];
	        this.filePath = source["filePath"];
	        this.byteCount = source["byteCount"];
	        this.lineCount = source["lineCount"];
	        this.active = source["active"];
	    }
	}
	export class SessionLogStatus {
	    sessionId: string;
	    logId?: string;
	    active: boolean;
	    filePath?: string;
	    byteCount: number;
	    lineCount: number;
	
	    static createFrom(source: any = {}) {
	        return new SessionLogStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.logId = source["logId"];
	        this.active = source["active"];
	        this.filePath = source["filePath"];
	        this.byteCount = source["byteCount"];
	        this.lineCount = source["lineCount"];
	    }
	}
	export class SnippetVariable {
	    name: string;
	    defaultValue?: string;
	    description?: string;
	    secretRef?: string;
	
	    static createFrom(source: any = {}) {
	        return new SnippetVariable(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.defaultValue = source["defaultValue"];
	        this.description = source["description"];
	        this.secretRef = source["secretRef"];
	    }
	}
	export class Snippet {
	    id: string;
	    name: string;
	    description?: string;
	    body: string;
	    variables?: SnippetVariable[];
	    tags?: string[];
	    confirmBeforeRun: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Snippet(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.body = source["body"];
	        this.variables = this.convertValues(source["variables"], SnippetVariable);
	        this.tags = source["tags"];
	        this.confirmBeforeRun = source["confirmBeforeRun"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SnippetContext {
	    hostId?: string;
	    hostLabel?: string;
	    address?: string;
	    hostname?: string;
	    ip?: string;
	    port?: number;
	    username?: string;
	    workingDir?: string;
	    timestamp?: string;
	    date?: string;
	    time?: string;
	    customVars?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new SnippetContext(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hostId = source["hostId"];
	        this.hostLabel = source["hostLabel"];
	        this.address = source["address"];
	        this.hostname = source["hostname"];
	        this.ip = source["ip"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.workingDir = source["workingDir"];
	        this.timestamp = source["timestamp"];
	        this.date = source["date"];
	        this.time = source["time"];
	        this.customVars = source["customVars"];
	    }
	}
	
	export class SshKeySummary {
	    id: string;
	    label: string;
	    type: string;
	    publicKey: string;
	    fingerprint: string;
	
	    static createFrom(source: any = {}) {
	        return new SshKeySummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.type = source["type"];
	        this.publicKey = source["publicKey"];
	        this.fingerprint = source["fingerprint"];
	    }
	}
	
	export class TerminalSpawnOptions {
	    mode: string;
	    workingDir: string;
	    splitDir: string;
	    size: TerminalSize;
	
	    static createFrom(source: any = {}) {
	        return new TerminalSpawnOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.mode = source["mode"];
	        this.workingDir = source["workingDir"];
	        this.splitDir = source["splitDir"];
	        this.size = this.convertValues(source["size"], TerminalSize);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class TotpCodeResponse {
	    id: string;
	    code: string;
	    remainingSeconds: number;
	    period: number;
	
	    static createFrom(source: any = {}) {
	        return new TotpCodeResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.code = source["code"];
	        this.remainingSeconds = source["remainingSeconds"];
	        this.period = source["period"];
	    }
	}
	export class TotpRecord {
	    id: string;
	    label: string;
	    issuer?: string;
	    secret: string;
	    algorithm?: string;
	    digits?: number;
	    period?: number;
	    hostId?: string;
	    createdAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new TotpRecord(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.issuer = source["issuer"];
	        this.secret = source["secret"];
	        this.algorithm = source["algorithm"];
	        this.digits = source["digits"];
	        this.period = source["period"];
	        this.hostId = source["hostId"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class TotpSummary {
	    id: string;
	    label: string;
	    issuer?: string;
	    algorithm: string;
	    digits: number;
	    period: number;
	    hostId?: string;
	    createdAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new TotpSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.issuer = source["issuer"];
	        this.algorithm = source["algorithm"];
	        this.digits = source["digits"];
	        this.period = source["period"];
	        this.hostId = source["hostId"];
	        this.createdAt = source["createdAt"];
	    }
	}
	export class TransferTask {
	    id: string;
	    sessionId: string;
	    direction: string;
	    localPath: string;
	    remotePath: string;
	    totalBytes: number;
	    transferredBytes: number;
	    speedBytesPerSec: number;
	    status: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new TransferTask(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sessionId = source["sessionId"];
	        this.direction = source["direction"];
	        this.localPath = source["localPath"];
	        this.remotePath = source["remotePath"];
	        this.totalBytes = source["totalBytes"];
	        this.transferredBytes = source["transferredBytes"];
	        this.speedBytesPerSec = source["speedBytesPerSec"];
	        this.status = source["status"];
	        this.error = source["error"];
	    }
	}
	export class VaultSummary {
	    groups: GroupRecord[];
	    hosts: HostSummary[];
	    identities: IdentitySummary[];
	    keys: SshKeySummary[];
	    proxyProfiles: ProxyProfileSummary[];
	    snippets: Snippet[];
	    totpRecords: TotpSummary[];
	    notes: NotePageSummary[];
	
	    static createFrom(source: any = {}) {
	        return new VaultSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.groups = this.convertValues(source["groups"], GroupRecord);
	        this.hosts = this.convertValues(source["hosts"], HostSummary);
	        this.identities = this.convertValues(source["identities"], IdentitySummary);
	        this.keys = this.convertValues(source["keys"], SshKeySummary);
	        this.proxyProfiles = this.convertValues(source["proxyProfiles"], ProxyProfileSummary);
	        this.snippets = this.convertValues(source["snippets"], Snippet);
	        this.totpRecords = this.convertValues(source["totpRecords"], TotpSummary);
	        this.notes = this.convertValues(source["notes"], NotePageSummary);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

