// utils.js
// Simple logger utility for p7-borders

class Logger {
	constructor(prefix = "p7-borders") {
		this.prefix = prefix;
	}

	log(...args) {
		global.log(`[${this.prefix}]`, ...args);
	}

	warn(...args) {
		global.logWarning(`[${this.prefix}]`, ...args);
	}

	error(...args) {
		global.logError(`[${this.prefix}]`, ...args);
	}
}

// Create and export a single global logger instance
const logger = new Logger();
export default logger;
