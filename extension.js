// extension.js

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { BorderManager } from "./bordermanager.js";

export default class P7BordersExtension extends Extension {
	constructor(metadata) {
		super(metadata);

		this._logger = this.getLogger();
		this._borderManager = new BorderManager(this._logger);
	}

	enable() {
		this._borderManager.enable(this.getSettings());
	}

	disable() {
		this._borderManager.disable();
	}
}
