export namespace core {
	
	export class AppStatus {
	    name: string;
	    version: string;
	    milestone: string;
	    vaultLocked: boolean;
	
	    static createFrom(source: any = {}) {
	        return new AppStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.version = source["version"];
	        this.milestone = source["milestone"];
	        this.vaultLocked = source["vaultLocked"];
	    }
	}

}

