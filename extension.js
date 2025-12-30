// extension.js

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { BorderManager } from "./bordermanager.js";

export default class P7BordersExtension extends Extension {
	constructor(metadata) {
		super(metadata);

		this._logger = this.getLogger();
		this._borderManager = null;
	}

	enable() {
		this._logger.log("Extension enabled");

		this._borderManager = new BorderManager(this._logger, this.getSettings());
		this._borderManager.enable();
	}

	disable() {
		this._logger.log("Extension disabled");

		if (this._borderManager) {
			this._borderManager.disable();
			this._borderManager = null;
		}
	}
}
