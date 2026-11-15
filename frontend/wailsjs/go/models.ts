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
	    engagementId?: string;
	
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
	        this.engagementId = source["engagementId"];
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
	export class CredentialEntry {
	    id: string;
	    engagementId: string;
	    category: string;
	    label: string;
	    username: string;
	    secret: string;
	    realm?: string;
	    hostId?: string;
	    source?: string;
	    notes?: string;
	    // Go type: time
	    capturedAt: any;
	    tags?: string[];
	
	    static createFrom(source: any = {}) {
	        return new CredentialEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.engagementId = source["engagementId"];
	        this.category = source["category"];
	        this.label = source["label"];
	        this.username = source["username"];
	        this.secret = source["secret"];
	        this.realm = source["realm"];
	        this.hostId = source["hostId"];
	        this.source = source["source"];
	        this.notes = source["notes"];
	        this.capturedAt = this.convertValues(source["capturedAt"], null);
	        this.tags = source["tags"];
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
	export class LockoutPolicy {
	    maxAttemptsPerUser: number;
	    lockoutWindowMinutes: number;
	    enforceDelaySeconds: number;
	    warningThresholdPercent: number;
	
	    static createFrom(source: any = {}) {
	        return new LockoutPolicy(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.maxAttemptsPerUser = source["maxAttemptsPerUser"];
	        this.lockoutWindowMinutes = source["lockoutWindowMinutes"];
	        this.enforceDelaySeconds = source["enforceDelaySeconds"];
	        this.warningThresholdPercent = source["warningThresholdPercent"];
	    }
	}
	export class Engagement {
	    id: string;
	    name: string;
	    scope: string;
	    timeframe: string;
	    lockoutPolicy: LockoutPolicy;
	    customCategories?: string[];
	    isActive: boolean;
	    // Go type: time
	    createdAt: any;
	    // Go type: time
	    updatedAt: any;
	
	    static createFrom(source: any = {}) {
	        return new Engagement(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.scope = source["scope"];
	        this.timeframe = source["timeframe"];
	        this.lockoutPolicy = this.convertValues(source["lockoutPolicy"], LockoutPolicy);
	        this.customCategories = source["customCategories"];
	        this.isActive = source["isActive"];
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
	export class SnippetChainStep {
	    id: string;
	    title: string;
	    description?: string;
	    snippetId?: string;
	    command: string;
	    confirmBeforeRun: boolean;
	    delayMs?: number;
	    stopOnError: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SnippetChainStep(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.description = source["description"];
	        this.snippetId = source["snippetId"];
	        this.command = source["command"];
	        this.confirmBeforeRun = source["confirmBeforeRun"];
	        this.delayMs = source["delayMs"];
	        this.stopOnError = source["stopOnError"];
	    }
	}
	export class SnippetChain {
	    id: string;
	    name: string;
	    description?: string;
	    hostId?: string;
	    targetOs?: string;
	    category?: string;
	    steps: SnippetChainStep[];
	    stopOnError: boolean;
	    autoRunWithoutPrompt: boolean;
	    tags?: string[];
	    createdAt?: string;
	    updatedAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new SnippetChain(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.hostId = source["hostId"];
	        this.targetOs = source["targetOs"];
	        this.category = source["category"];
	        this.steps = this.convertValues(source["steps"], SnippetChainStep);
	        this.stopOnError = source["stopOnError"];
	        this.autoRunWithoutPrompt = source["autoRunWithoutPrompt"];
	        this.tags = source["tags"];
	        this.createdAt = source["createdAt"];
	        this.updatedAt = source["updatedAt"];
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
	export class NotePage {
	    id: string;
	    hostId?: string;
	    engagementId?: string;
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
	        this.engagementId = source["engagementId"];
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
	export class FindingItem {
	    id: string;
	    engagementId: string;
	    title: string;
	    category: string;
	    severity: string;
	    status: string;
	    hostId?: string;
	    affectedHosts?: string[];
	    description: string;
	    impact?: string;
	    remediation?: string;
	    cve?: string;
	    cvss?: string;
	    cvssVector?: string;
	    mitreAttack?: string;
	    evidenceIds?: string[];
	    noteIds?: string[];
	    // Go type: time
	    createdAt: any;
	    // Go type: time
	    updatedAt: any;
	    tags?: string[];
	
	    static createFrom(source: any = {}) {
	        return new FindingItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.engagementId = source["engagementId"];
	        this.title = source["title"];
	        this.category = source["category"];
	        this.severity = source["severity"];
	        this.status = source["status"];
	        this.hostId = source["hostId"];
	        this.affectedHosts = source["affectedHosts"];
	        this.description = source["description"];
	        this.impact = source["impact"];
	        this.remediation = source["remediation"];
	        this.cve = source["cve"];
	        this.cvss = source["cvss"];
	        this.cvssVector = source["cvssVector"];
	        this.mitreAttack = source["mitreAttack"];
	        this.evidenceIds = source["evidenceIds"];
	        this.noteIds = source["noteIds"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	        this.updatedAt = this.convertValues(source["updatedAt"], null);
	        this.tags = source["tags"];
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
	export class EvidenceItem {
	    id: string;
	    engagementId: string;
	    findingId?: string;
	    category: string;
	    title: string;
	    type: string;
	    content: string;
	    hostId?: string;
	    severity?: string;
	    // Go type: time
	    capturedAt: any;
	    source?: string;
	    inReport: boolean;
	    tags?: string[];
	
	    static createFrom(source: any = {}) {
	        return new EvidenceItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.engagementId = source["engagementId"];
	        this.findingId = source["findingId"];
	        this.category = source["category"];
	        this.title = source["title"];
	        this.type = source["type"];
	        this.content = source["content"];
	        this.hostId = source["hostId"];
	        this.severity = source["severity"];
	        this.capturedAt = this.convertValues(source["capturedAt"], null);
	        this.source = source["source"];
	        this.inReport = source["inReport"];
	        this.tags = source["tags"];
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
	    engagementId?: string;
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
	        this.engagementId = source["engagementId"];
	        this.type = source["type"];
	        this.jumpHostIds = source["jumpHostIds"];
	        this.command = source["command"];
	        this.socksAddress = source["socksAddress"];
	        this.socksUsername = source["socksUsername"];
	        this.socksPassword = source["socksPassword"];
	    }
	}
	export class ForwardRule {
	    id: string;
	    hostId?: string;
	    engagementId?: string;
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
	        this.engagementId = source["engagementId"];
	        this.type = source["type"];
	        this.bindAddress = source["bindAddress"];
	        this.bindPort = source["bindPort"];
	        this.targetHost = source["targetHost"];
	        this.targetPort = source["targetPort"];
	        this.autoStart = source["autoStart"];
	        this.label = source["label"];
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
	    engagementId?: string;
	
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
	        this.engagementId = source["engagementId"];
	    }
	}
	export class EngagementPackage {
	    version: number;
	    encrypted: boolean;
	    salt?: string;
	    nonce?: string;
	    ciphertext?: string;
	    engagement: Engagement;
	    hosts?: HostRecord[];
	    forwardRules?: ForwardRule[];
	    proxyProfiles?: ProxyProfile[];
	    credentials?: CredentialEntry[];
	    evidence?: EvidenceItem[];
	    findings?: FindingItem[];
	    notes?: NotePage[];
	    snippets?: Snippet[];
	    snippetChains?: SnippetChain[];
	    wordlists?: string[];
	
	    static createFrom(source: any = {}) {
	        return new EngagementPackage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.encrypted = source["encrypted"];
	        this.salt = source["salt"];
	        this.nonce = source["nonce"];
	        this.ciphertext = source["ciphertext"];
	        this.engagement = this.convertValues(source["engagement"], Engagement);
	        this.hosts = this.convertValues(source["hosts"], HostRecord);
	        this.forwardRules = this.convertValues(source["forwardRules"], ForwardRule);
	        this.proxyProfiles = this.convertValues(source["proxyProfiles"], ProxyProfile);
	        this.credentials = this.convertValues(source["credentials"], CredentialEntry);
	        this.evidence = this.convertValues(source["evidence"], EvidenceItem);
	        this.findings = this.convertValues(source["findings"], FindingItem);
	        this.notes = this.convertValues(source["notes"], NotePage);
	        this.snippets = this.convertValues(source["snippets"], Snippet);
	        this.snippetChains = this.convertValues(source["snippetChains"], SnippetChain);
	        this.wordlists = source["wordlists"];
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
	export class FileTransferCommandOptions {
	    filename: string;
	    localIp: string;
	    port: number;
	    useTLS: boolean;
	    targetOs: string;
	    targetDestDir?: string;
	    shareName?: string;
	    sha256?: string;
	    md5?: string;
	    enableUpload: boolean;
	    uploadFilePath?: string;
	    basicAuthUser?: string;
	
	    static createFrom(source: any = {}) {
	        return new FileTransferCommandOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filename = source["filename"];
	        this.localIp = source["localIp"];
	        this.port = source["port"];
	        this.useTLS = source["useTLS"];
	        this.targetOs = source["targetOs"];
	        this.targetDestDir = source["targetDestDir"];
	        this.shareName = source["shareName"];
	        this.sha256 = source["sha256"];
	        this.md5 = source["md5"];
	        this.enableUpload = source["enableUpload"];
	        this.uploadFilePath = source["uploadFilePath"];
	        this.basicAuthUser = source["basicAuthUser"];
	    }
	}
	export class TargetTransferMethod {
	    id: string;
	    tool: string;
	    title: string;
	    targetOs: string;
	    category: string;
	    command: string;
	    notes?: string;
	
	    static createFrom(source: any = {}) {
	        return new TargetTransferMethod(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.tool = source["tool"];
	        this.title = source["title"];
	        this.targetOs = source["targetOs"];
	        this.category = source["category"];
	        this.command = source["command"];
	        this.notes = source["notes"];
	    }
	}
	export class FileTransferCommandSet {
	    filename: string;
	    url: string;
	    localIp: string;
	    port: number;
	    sha256?: string;
	    md5?: string;
	    methods: TargetTransferMethod[];
	    opsecWarnings?: string[];
	
	    static createFrom(source: any = {}) {
	        return new FileTransferCommandSet(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filename = source["filename"];
	        this.url = source["url"];
	        this.localIp = source["localIp"];
	        this.port = source["port"];
	        this.sha256 = source["sha256"];
	        this.md5 = source["md5"];
	        this.methods = this.convertValues(source["methods"], TargetTransferMethod);
	        this.opsecWarnings = source["opsecWarnings"];
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
	export class FileTransferEvent {
	    timestamp: string;
	    method: string;
	    path: string;
	    remoteAddr: string;
	    status: number;
	    bytes: number;
	    note?: string;
	
	    static createFrom(source: any = {}) {
	        return new FileTransferEvent(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.timestamp = source["timestamp"];
	        this.method = source["method"];
	        this.path = source["path"];
	        this.remoteAddr = source["remoteAddr"];
	        this.status = source["status"];
	        this.bytes = source["bytes"];
	        this.note = source["note"];
	    }
	}
	export class FileTransferServerConfig {
	    id: string;
	    name: string;
	    kind: string;
	    directory: string;
	    bindAddress: string;
	    port: number;
	    enableUpload: boolean;
	    useTLS: boolean;
	    shareName?: string;
	    basicAuthUser?: string;
	    basicAuthPassword?: string;
	
	    static createFrom(source: any = {}) {
	        return new FileTransferServerConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.directory = source["directory"];
	        this.bindAddress = source["bindAddress"];
	        this.port = source["port"];
	        this.enableUpload = source["enableUpload"];
	        this.useTLS = source["useTLS"];
	        this.shareName = source["shareName"];
	        this.basicAuthUser = source["basicAuthUser"];
	        this.basicAuthPassword = source["basicAuthPassword"];
	    }
	}
	export class FileTransferServerInfo {
	    id: string;
	    name: string;
	    kind: string;
	    directory: string;
	    bindAddress: string;
	    port: number;
	    enableUpload: boolean;
	    useTLS: boolean;
	    shareName?: string;
	    hasBasicAuth: boolean;
	    status: string;
	    startedAt?: string;
	    servedCount: number;
	    uploadCount: number;
	    commandPreview: string;
	    opsecWarnings?: string[];
	    recentEvents?: FileTransferEvent[];
	    errorMsg?: string;
	
	    static createFrom(source: any = {}) {
	        return new FileTransferServerInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.directory = source["directory"];
	        this.bindAddress = source["bindAddress"];
	        this.port = source["port"];
	        this.enableUpload = source["enableUpload"];
	        this.useTLS = source["useTLS"];
	        this.shareName = source["shareName"];
	        this.hasBasicAuth = source["hasBasicAuth"];
	        this.status = source["status"];
	        this.startedAt = source["startedAt"];
	        this.servedCount = source["servedCount"];
	        this.uploadCount = source["uploadCount"];
	        this.commandPreview = source["commandPreview"];
	        this.opsecWarnings = source["opsecWarnings"];
	        this.recentEvents = this.convertValues(source["recentEvents"], FileTransferEvent);
	        this.errorMsg = source["errorMsg"];
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
	
	
	
	export class HostedFileEntry {
	    name: string;
	    relPath: string;
	    fullPath: string;
	    size: number;
	    isDir: boolean;
	    modTime: string;
	    sha256?: string;
	    md5?: string;
	
	    static createFrom(source: any = {}) {
	        return new HostedFileEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.relPath = source["relPath"];
	        this.fullPath = source["fullPath"];
	        this.size = source["size"];
	        this.isDir = source["isDir"];
	        this.modTime = source["modTime"];
	        this.sha256 = source["sha256"];
	        this.md5 = source["md5"];
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
	export class ImportedForwardRule {
	    type: string;
	    bindPort: number;
	    targetHost: string;
	    targetPort: number;
	
	    static createFrom(source: any = {}) {
	        return new ImportedForwardRule(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.bindPort = source["bindPort"];
	        this.targetHost = source["targetHost"];
	        this.targetPort = source["targetPort"];
	    }
	}
	export class ImportedHostEntry {
	    label: string;
	    address: string;
	    port: number;
	    username: string;
	    group?: string;
	    tags?: string[];
	    keyPath?: string;
	    password?: string;
	    proxyCommand?: string;
	    forwardRules?: ImportedForwardRule[];
	    alreadyExist?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ImportedHostEntry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.label = source["label"];
	        this.address = source["address"];
	        this.port = source["port"];
	        this.username = source["username"];
	        this.group = source["group"];
	        this.tags = source["tags"];
	        this.keyPath = source["keyPath"];
	        this.password = source["password"];
	        this.proxyCommand = source["proxyCommand"];
	        this.forwardRules = this.convertValues(source["forwardRules"], ImportedForwardRule);
	        this.alreadyExist = source["alreadyExist"];
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
	export class ImportExecuteOptions {
	    selectedHosts: ImportedHostEntry[];
	    defaultGroup?: string;
	    importKeys: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ImportExecuteOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.selectedHosts = this.convertValues(source["selectedHosts"], ImportedHostEntry);
	        this.defaultGroup = source["defaultGroup"];
	        this.importKeys = source["importKeys"];
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
	export class ImportExecuteResult {
	    hostsImported: number;
	    groupsCreated: number;
	    keysImported: number;
	    tunnelsConfigured: number;
	    warnings: string[];
	
	    static createFrom(source: any = {}) {
	        return new ImportExecuteResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hostsImported = source["hostsImported"];
	        this.groupsCreated = source["groupsCreated"];
	        this.keysImported = source["keysImported"];
	        this.tunnelsConfigured = source["tunnelsConfigured"];
	        this.warnings = source["warnings"];
	    }
	}
	export class ImportScanResult {
	    sourceType: string;
	    hosts: ImportedHostEntry[];
	    groups: string[];
	    totalFound: number;
	    warnings: string[];
	
	    static createFrom(source: any = {}) {
	        return new ImportScanResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sourceType = source["sourceType"];
	        this.hosts = this.convertValues(source["hosts"], ImportedHostEntry);
	        this.groups = source["groups"];
	        this.totalFound = source["totalFound"];
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
	
	
	export class ListenerProfile {
	    id: string;
	    name: string;
	    kind: string;
	    tool: string;
	    bindAddress: string;
	    bindPort: number;
	    autoSpawnTab: boolean;
	    options?: Record<string, string>;
	    notes?: string;
	    createdAt?: string;
	
	    static createFrom(source: any = {}) {
	        return new ListenerProfile(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.tool = source["tool"];
	        this.bindAddress = source["bindAddress"];
	        this.bindPort = source["bindPort"];
	        this.autoSpawnTab = source["autoSpawnTab"];
	        this.options = source["options"];
	        this.notes = source["notes"];
	        this.createdAt = source["createdAt"];
	    }
	}
	
	export class RawTcpSessionStats {
	    id: string;
	    remoteAddr: string;
	    localAddr: string;
	    isListener: boolean;
	    listenerPort?: number;
	    bytesSent: number;
	    bytesReceived: number;
	    // Go type: time
	    connectedAt: any;
	    lineMode: boolean;
	    lineEnding: string;
	
	    static createFrom(source: any = {}) {
	        return new RawTcpSessionStats(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.remoteAddr = source["remoteAddr"];
	        this.localAddr = source["localAddr"];
	        this.isListener = source["isListener"];
	        this.listenerPort = source["listenerPort"];
	        this.bytesSent = source["bytesSent"];
	        this.bytesReceived = source["bytesReceived"];
	        this.connectedAt = this.convertValues(source["connectedAt"], null);
	        this.lineMode = source["lineMode"];
	        this.lineEnding = source["lineEnding"];
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
	export class ManagedListenerInfo {
	    id: string;
	    profileId?: string;
	    name: string;
	    kind: string;
	    tool: string;
	    bindAddress: string;
	    bindPort: number;
	    status: string;
	    errorMsg?: string;
	    startedAt?: string;
	    catchCount: number;
	    activeSessions?: RawTcpSessionStats[];
	    commandPreview?: string;
	    opsecWarnings?: string[];
	
	    static createFrom(source: any = {}) {
	        return new ManagedListenerInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.profileId = source["profileId"];
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.tool = source["tool"];
	        this.bindAddress = source["bindAddress"];
	        this.bindPort = source["bindPort"];
	        this.status = source["status"];
	        this.errorMsg = source["errorMsg"];
	        this.startedAt = source["startedAt"];
	        this.catchCount = source["catchCount"];
	        this.activeSessions = this.convertValues(source["activeSessions"], RawTcpSessionStats);
	        this.commandPreview = source["commandPreview"];
	        this.opsecWarnings = source["opsecWarnings"];
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
	export class NetworkInterfaceIP {
	    interface: string;
	    ip: string;
	    cidr: string;
	    isVpn: boolean;
	
	    static createFrom(source: any = {}) {
	        return new NetworkInterfaceIP(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.interface = source["interface"];
	        this.ip = source["ip"];
	        this.cidr = source["cidr"];
	        this.isVpn = source["isVpn"];
	    }
	}
	export class NmapImportOptions {
	    engagementId?: string;
	    groupId?: string;
	    createHostRecords: boolean;
	    createPortNotes: boolean;
	    createSummaryNotes: boolean;
	    createPortFindings: boolean;
	    onlyUpHosts: boolean;
	    tagPrefix?: string;
	
	    static createFrom(source: any = {}) {
	        return new NmapImportOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.engagementId = source["engagementId"];
	        this.groupId = source["groupId"];
	        this.createHostRecords = source["createHostRecords"];
	        this.createPortNotes = source["createPortNotes"];
	        this.createSummaryNotes = source["createSummaryNotes"];
	        this.createPortFindings = source["createPortFindings"];
	        this.onlyUpHosts = source["onlyUpHosts"];
	        this.tagPrefix = source["tagPrefix"];
	    }
	}
	export class NmapImportRequest {
	    xmlContent: string;
	    options: NmapImportOptions;
	
	    static createFrom(source: any = {}) {
	        return new NmapImportRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.xmlContent = source["xmlContent"];
	        this.options = this.convertValues(source["options"], NmapImportOptions);
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
	export class NmapImportSummary {
	    createdHosts: number;
	    updatedHosts: number;
	    createdNotes: number;
	    createdPortNotes: number;
	    createdPortFindings: number;
	    hostIds: string[];
	    scanKind: string;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new NmapImportSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.createdHosts = source["createdHosts"];
	        this.updatedHosts = source["updatedHosts"];
	        this.createdNotes = source["createdNotes"];
	        this.createdPortNotes = source["createdPortNotes"];
	        this.createdPortFindings = source["createdPortFindings"];
	        this.hostIds = source["hostIds"];
	        this.scanKind = source["scanKind"];
	        this.message = source["message"];
	    }
	}
	export class ParsedNmapPort {
	    port: number;
	    protocol: string;
	    state: string;
	    reason: string;
	    service: string;
	    product: string;
	    version: string;
	    extraInfo: string;
	    osType: string;
	    cpes: string[];
	    scripts: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new ParsedNmapPort(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.port = source["port"];
	        this.protocol = source["protocol"];
	        this.state = source["state"];
	        this.reason = source["reason"];
	        this.service = source["service"];
	        this.product = source["product"];
	        this.version = source["version"];
	        this.extraInfo = source["extraInfo"];
	        this.osType = source["osType"];
	        this.cpes = source["cpes"];
	        this.scripts = source["scripts"];
	    }
	}
	export class ParsedNmapHost {
	    ipv4: string;
	    ipv6: string;
	    mac: string;
	    macVendor: string;
	    hostnames: string[];
	    primaryName: string;
	    state: string;
	    reason: string;
	    osName: string;
	    osAccuracy: string;
	    openPorts: ParsedNmapPort[];
	    filteredPorts: ParsedNmapPort[];
	    closedCount: number;
	    filteredCount: number;
	    isAliveOnly: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ParsedNmapHost(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.ipv4 = source["ipv4"];
	        this.ipv6 = source["ipv6"];
	        this.mac = source["mac"];
	        this.macVendor = source["macVendor"];
	        this.hostnames = source["hostnames"];
	        this.primaryName = source["primaryName"];
	        this.state = source["state"];
	        this.reason = source["reason"];
	        this.osName = source["osName"];
	        this.osAccuracy = source["osAccuracy"];
	        this.openPorts = this.convertValues(source["openPorts"], ParsedNmapPort);
	        this.filteredPorts = this.convertValues(source["filteredPorts"], ParsedNmapPort);
	        this.closedCount = source["closedCount"];
	        this.filteredCount = source["filteredCount"];
	        this.isAliveOnly = source["isAliveOnly"];
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
	export class NmapScanResult {
	    scanner: string;
	    args: string;
	    version: string;
	    startStr: string;
	    summary: string;
	    elapsedSecs: string;
	    scanKind: string;
	    totalHosts: number;
	    upHostsCount: number;
	    downHostsCount: number;
	    totalOpenPorts: number;
	    hosts: ParsedNmapHost[];
	
	    static createFrom(source: any = {}) {
	        return new NmapScanResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.scanner = source["scanner"];
	        this.args = source["args"];
	        this.version = source["version"];
	        this.startStr = source["startStr"];
	        this.summary = source["summary"];
	        this.elapsedSecs = source["elapsedSecs"];
	        this.scanKind = source["scanKind"];
	        this.totalHosts = source["totalHosts"];
	        this.upHostsCount = source["upHostsCount"];
	        this.downHostsCount = source["downHostsCount"];
	        this.totalOpenPorts = source["totalOpenPorts"];
	        this.hosts = this.convertValues(source["hosts"], ParsedNmapHost);
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
	    engagementId?: string;
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
	        this.engagementId = source["engagementId"];
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
	export class PaneItem {
	    id: string;
	    sessionId: string;
	    hostId?: string;
	    title: string;
	    cwd?: string;
	    paneType?: string;
	    notesHostId?: string;
	    sftpSessionId?: string;
	    editSessionId?: string;
	    editRemotePath?: string;
	
	    static createFrom(source: any = {}) {
	        return new PaneItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sessionId = source["sessionId"];
	        this.hostId = source["hostId"];
	        this.title = source["title"];
	        this.cwd = source["cwd"];
	        this.paneType = source["paneType"];
	        this.notesHostId = source["notesHostId"];
	        this.sftpSessionId = source["sftpSessionId"];
	        this.editSessionId = source["editSessionId"];
	        this.editRemotePath = source["editRemotePath"];
	    }
	}
	
	
	export class PayloadFileConfig {
	    filePath: string;
	    templateCount: number;
	    exists: boolean;
	    lastModified?: string;
	
	    static createFrom(source: any = {}) {
	        return new PayloadFileConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filePath = source["filePath"];
	        this.templateCount = source["templateCount"];
	        this.exists = source["exists"];
	        this.lastModified = source["lastModified"];
	    }
	}
	export class PayloadRenderOptions {
	    templateId: string;
	    lhost: string;
	    lport: number;
	    encoding?: string;
	    customVars?: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new PayloadRenderOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.templateId = source["templateId"];
	        this.lhost = source["lhost"];
	        this.lport = source["lport"];
	        this.encoding = source["encoding"];
	        this.customVars = source["customVars"];
	    }
	}
	export class PayloadRenderResult {
	    templateId: string;
	    rawCommand: string;
	    rendered: string;
	    encoding: string;
	    opsecWarnings?: string[];
	    resolvedVars: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new PayloadRenderResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.templateId = source["templateId"];
	        this.rawCommand = source["rawCommand"];
	        this.rendered = source["rendered"];
	        this.encoding = source["encoding"];
	        this.opsecWarnings = source["opsecWarnings"];
	        this.resolvedVars = source["resolvedVars"];
	    }
	}
	export class PayloadTemplate {
	    id: string;
	    name: string;
	    description?: string;
	    os: string;
	    shell: string;
	    kind: string;
	    command: string;
	    defaultPort?: number;
	    variables?: SnippetVariable[];
	    tags?: string[];
	    opsecRisk?: string;
	    notes?: string;
	
	    static createFrom(source: any = {}) {
	        return new PayloadTemplate(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.os = source["os"];
	        this.shell = source["shell"];
	        this.kind = source["kind"];
	        this.command = source["command"];
	        this.defaultPort = source["defaultPort"];
	        this.variables = this.convertValues(source["variables"], SnippetVariable);
	        this.tags = source["tags"];
	        this.opsecRisk = source["opsecRisk"];
	        this.notes = source["notes"];
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
	
	export class ProxyProfileSummary {
	    id: string;
	    name: string;
	    engagementId?: string;
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
	        this.engagementId = source["engagementId"];
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
	    engagementId?: string;
	
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
	        this.engagementId = source["engagementId"];
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
	
	
	export class RawTcpConfig {
	    host: string;
	    port: number;
	    lineMode: boolean;
	    lineEnding: string;
	    timeoutSec: number;
	
	    static createFrom(source: any = {}) {
	        return new RawTcpConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.port = source["port"];
	        this.lineMode = source["lineMode"];
	        this.lineEnding = source["lineEnding"];
	        this.timeoutSec = source["timeoutSec"];
	    }
	}
	export class RawTcpListenerConfig {
	    port: number;
	    bindAddress: string;
	    autoSpawnTab: boolean;
	
	    static createFrom(source: any = {}) {
	        return new RawTcpListenerConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.port = source["port"];
	        this.bindAddress = source["bindAddress"];
	        this.autoSpawnTab = source["autoSpawnTab"];
	    }
	}
	export class RawTcpListenerInfo {
	    id: string;
	    port: number;
	    bindAddress: string;
	    status: string;
	    // Go type: time
	    startedAt: any;
	    totalCatches: number;
	
	    static createFrom(source: any = {}) {
	        return new RawTcpListenerInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.port = source["port"];
	        this.bindAddress = source["bindAddress"];
	        this.status = source["status"];
	        this.startedAt = this.convertValues(source["startedAt"], null);
	        this.totalCatches = source["totalCatches"];
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
	
	export class RemoteConflictInfo {
	    hasConflict: boolean;
	    remotePath: string;
	    initialModTime: number;
	    remoteModTime: number;
	    initialSize: number;
	    remoteSize: number;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new RemoteConflictInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hasConflict = source["hasConflict"];
	        this.remotePath = source["remotePath"];
	        this.initialModTime = source["initialModTime"];
	        this.remoteModTime = source["remoteModTime"];
	        this.initialSize = source["initialSize"];
	        this.remoteSize = source["remoteSize"];
	        this.message = source["message"];
	    }
	}
	export class RemoteEditResult {
	    success: boolean;
	    conflict: boolean;
	    remoteModTime: number;
	    remoteSize: number;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new RemoteEditResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.success = source["success"];
	        this.conflict = source["conflict"];
	        this.remoteModTime = source["remoteModTime"];
	        this.remoteSize = source["remoteSize"];
	        this.message = source["message"];
	    }
	}
	export class RemoteEditSession {
	    id: string;
	    sessionId: string;
	    remotePath: string;
	    localPath: string;
	    filename: string;
	    initialModTime: number;
	    initialSize: number;
	    initialHash: string;
	    status: string;
	    lastUploadedAt: number;
	    hasConflict: boolean;
	    errorMessage?: string;
	
	    static createFrom(source: any = {}) {
	        return new RemoteEditSession(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.sessionId = source["sessionId"];
	        this.remotePath = source["remotePath"];
	        this.localPath = source["localPath"];
	        this.filename = source["filename"];
	        this.initialModTime = source["initialModTime"];
	        this.initialSize = source["initialSize"];
	        this.initialHash = source["initialHash"];
	        this.status = source["status"];
	        this.lastUploadedAt = source["lastUploadedAt"];
	        this.hasConflict = source["hasConflict"];
	        this.errorMessage = source["errorMessage"];
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
	export class ShellStabilizePreset {
	    id: string;
	    name: string;
	    os: string;
	    description: string;
	    command: string;
	
	    static createFrom(source: any = {}) {
	        return new ShellStabilizePreset(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.os = source["os"];
	        this.description = source["description"];
	        this.command = source["command"];
	    }
	}
	export class ShellStabilizeRequest {
	    sessionId: string;
	    method: string;
	    mode: string;
	    shellPath: string;
	    term: string;
	    cols: number;
	    rows: number;
	    lhost?: string;
	    lport?: number;
	    resetTerminal?: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ShellStabilizeRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.method = source["method"];
	        this.mode = source["mode"];
	        this.shellPath = source["shellPath"];
	        this.term = source["term"];
	        this.cols = source["cols"];
	        this.rows = source["rows"];
	        this.lhost = source["lhost"];
	        this.lport = source["lport"];
	        this.resetTerminal = source["resetTerminal"];
	    }
	}
	
	
	
	export class SnippetChainsFileConfig {
	    filePath: string;
	    chainCount: number;
	    exists: boolean;
	    lastModified?: string;
	
	    static createFrom(source: any = {}) {
	        return new SnippetChainsFileConfig(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filePath = source["filePath"];
	        this.chainCount = source["chainCount"];
	        this.exists = source["exists"];
	        this.lastModified = source["lastModified"];
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
	
	export class SprayExportOptions {
	    engagementId: string;
	    credentialIds: string[];
	    format: string;
	    customUserList?: string;
	    customPasswordList?: string;
	    delimiter?: string;
	
	    static createFrom(source: any = {}) {
	        return new SprayExportOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.engagementId = source["engagementId"];
	        this.credentialIds = source["credentialIds"];
	        this.format = source["format"];
	        this.customUserList = source["customUserList"];
	        this.customPasswordList = source["customPasswordList"];
	        this.delimiter = source["delimiter"];
	    }
	}
	export class SprayWarning {
	    exceedsPolicy: boolean;
	    severity: string;
	    message: string;
	    totalCombinations: number;
	    maxAttemptsPerAccount: number;
	    policyLimit: number;
	
	    static createFrom(source: any = {}) {
	        return new SprayWarning(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.exceedsPolicy = source["exceedsPolicy"];
	        this.severity = source["severity"];
	        this.message = source["message"];
	        this.totalCombinations = source["totalCombinations"];
	        this.maxAttemptsPerAccount = source["maxAttemptsPerAccount"];
	        this.policyLimit = source["policyLimit"];
	    }
	}
	export class SprayExportResult {
	    content: string;
	    lineCount: number;
	    uniqueUsers: number;
	    uniquePasswords: number;
	    warning?: SprayWarning;
	
	    static createFrom(source: any = {}) {
	        return new SprayExportResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.content = source["content"];
	        this.lineCount = source["lineCount"];
	        this.uniqueUsers = source["uniqueUsers"];
	        this.uniquePasswords = source["uniquePasswords"];
	        this.warning = this.convertValues(source["warning"], SprayWarning);
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
	export class WorkspaceNode {
	    type: string;
	    id: string;
	    sessionId?: string;
	    hostId?: string;
	    title?: string;
	    cwd?: string;
	    paneType?: string;
	    notesHostId?: string;
	    sftpSessionId?: string;
	    editSessionId?: string;
	    editRemotePath?: string;
	    direction?: string;
	    children?: WorkspaceNode[];
	    ratios?: number[];
	
	    static createFrom(source: any = {}) {
	        return new WorkspaceNode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.id = source["id"];
	        this.sessionId = source["sessionId"];
	        this.hostId = source["hostId"];
	        this.title = source["title"];
	        this.cwd = source["cwd"];
	        this.paneType = source["paneType"];
	        this.notesHostId = source["notesHostId"];
	        this.sftpSessionId = source["sftpSessionId"];
	        this.editSessionId = source["editSessionId"];
	        this.editRemotePath = source["editRemotePath"];
	        this.direction = source["direction"];
	        this.children = this.convertValues(source["children"], WorkspaceNode);
	        this.ratios = source["ratios"];
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
	export class TabItem {
	    id: string;
	    title: string;
	    hostId?: string;
	    color?: string;
	    splitDir?: string;
	    panes?: PaneItem[];
	    rootNode?: WorkspaceNode;
	    activePaneId: string;
	    tabType?: string;
	    notesHostId?: string;
	
	    static createFrom(source: any = {}) {
	        return new TabItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.title = source["title"];
	        this.hostId = source["hostId"];
	        this.color = source["color"];
	        this.splitDir = source["splitDir"];
	        this.panes = this.convertValues(source["panes"], PaneItem);
	        this.rootNode = this.convertValues(source["rootNode"], WorkspaceNode);
	        this.activePaneId = source["activePaneId"];
	        this.tabType = source["tabType"];
	        this.notesHostId = source["notesHostId"];
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
	export class VaultConflictItem {
	    id: string;
	    type: string;
	    label: string;
	    localSummary: string;
	    remoteSummary: string;
	
	    static createFrom(source: any = {}) {
	        return new VaultConflictItem(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.type = source["type"];
	        this.label = source["label"];
	        this.localSummary = source["localSummary"];
	        this.remoteSummary = source["remoteSummary"];
	    }
	}
	export class VaultConflictReport {
	    hasConflicts: boolean;
	    conflicts: VaultConflictItem[];
	    autoMerged: number;
	
	    static createFrom(source: any = {}) {
	        return new VaultConflictReport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.hasConflicts = source["hasConflicts"];
	        this.conflicts = this.convertValues(source["conflicts"], VaultConflictItem);
	        this.autoMerged = source["autoMerged"];
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
	export class VaultSummary {
	    groups: GroupRecord[];
	    hosts: HostSummary[];
	    identities: IdentitySummary[];
	    keys: SshKeySummary[];
	    proxyProfiles: ProxyProfileSummary[];
	    snippets: Snippet[];
	    snippetChains: SnippetChain[];
	    totpRecords: TotpSummary[];
	    notes: NotePageSummary[];
	    listeners: ListenerProfile[];
	
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
	        this.snippetChains = this.convertValues(source["snippetChains"], SnippetChain);
	        this.totpRecords = this.convertValues(source["totpRecords"], TotpSummary);
	        this.notes = this.convertValues(source["notes"], NotePageSummary);
	        this.listeners = this.convertValues(source["listeners"], ListenerProfile);
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
	export class VaultSyncInfo {
	    filePath: string;
	    fileSize: number;
	    lastModified: number;
	    status: string;
	    syncConflictFiles?: string[];
	    detectedConflict: boolean;
	    conflictCount: number;
	
	    static createFrom(source: any = {}) {
	        return new VaultSyncInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.filePath = source["filePath"];
	        this.fileSize = source["fileSize"];
	        this.lastModified = source["lastModified"];
	        this.status = source["status"];
	        this.syncConflictFiles = source["syncConflictFiles"];
	        this.detectedConflict = source["detectedConflict"];
	        this.conflictCount = source["conflictCount"];
	    }
	}
	
	export class WorkspaceState {
	    version: number;
	    activeTabId: string;
	    tabs: TabItem[];
	    autoRestore: boolean;
	    // Go type: time
	    savedAt: any;
	
	    static createFrom(source: any = {}) {
	        return new WorkspaceState(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.activeTabId = source["activeTabId"];
	        this.tabs = this.convertValues(source["tabs"], TabItem);
	        this.autoRestore = source["autoRestore"];
	        this.savedAt = this.convertValues(source["savedAt"], null);
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

