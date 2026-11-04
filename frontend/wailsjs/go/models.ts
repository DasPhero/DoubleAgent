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
	    privateKey: string;
	    passphrase: string;
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
	        this.privateKey = source["privateKey"];
	        this.passphrase = source["passphrase"];
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
	export class GroupDefaults {
	    port?: number;
	    username?: string;
	    identityId?: string;
	    keepaliveSecs?: number;
	
	    static createFrom(source: any = {}) {
	        return new GroupDefaults(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.port = source["port"];
	        this.username = source["username"];
	        this.identityId = source["identityId"];
	        this.keepaliveSecs = source["keepaliveSecs"];
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
	    tags?: string[];
	    color?: string;
	    favorite?: boolean;
	    jumpChain?: string[];
	    forwardRuleIds?: string[];
	
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
	        this.tags = source["tags"];
	        this.color = source["color"];
	        this.favorite = source["favorite"];
	        this.jumpChain = source["jumpChain"];
	        this.forwardRuleIds = source["forwardRuleIds"];
	    }
	}
	export class HostSummary {
	    id: string;
	    label: string;
	    address: string;
	    effectivePort: number;
	    effectiveUser: string;
	    keepaliveSecs: number;
	    groupId: string;
	    identityId: string;
	    tags: string[];
	    color: string;
	    favorite: boolean;
	
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
	        this.keepaliveSecs = source["keepaliveSecs"];
	        this.groupId = source["groupId"];
	        this.identityId = source["identityId"];
	        this.tags = source["tags"];
	        this.color = source["color"];
	        this.favorite = source["favorite"];
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
	
	    static createFrom(source: any = {}) {
	        return new IdentitySummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.label = source["label"];
	        this.username = source["username"];
	        this.authMethod = source["authMethod"];
	    }
	}
	
	export class VaultSummary {
	    groups: GroupRecord[];
	    hosts: HostSummary[];
	    identities: IdentitySummary[];
	
	    static createFrom(source: any = {}) {
	        return new VaultSummary(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.groups = this.convertValues(source["groups"], GroupRecord);
	        this.hosts = this.convertValues(source["hosts"], HostSummary);
	        this.identities = this.convertValues(source["identities"], IdentitySummary);
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

