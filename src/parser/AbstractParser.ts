import { IFile } from '../IConfig';
import * as babel from 'babel-core';
const { NodeVM, VMScript } = require('vm2');
const mustache = require('mustache');
const pify = require('pify');
const fs = require('fs');
const path = require('path');
const mkdirp = require('mkdirp');

abstract class AbstractParser {
	protected file:IFile = null;
	private templateFile:string;
	private _defaultTemplate:string = path.resolve(__dirname, './template/scss-map.mustache');
	private _varMap:{[index:string]:Array<{keyName:string;keyValue:string}>} = {};
	private _rootKey:string;

	/**
	 * @param file
	 */
	constructor(file:IFile) {
		this.file = file;
		this.templateFile = file.template ? path.resolve(file.template) : path.resolve(this._defaultTemplate);
	}

	/**
	 * Flattens object and prepares the object for the mustache template engine
	 * @param obj
	 * @returns {{[p: string]: Array<{keyName: string, keyValue: string}>}}
	 */
	protected mapObject(obj:{[index:string]:string}) {
		if(!obj) {
			return;
		}

		for (const key in obj) {
			if (typeof obj[key] === "object" && obj[key] !== null) {
				this._rootKey = key;
				this.mapObject(<any> obj[key]);
			} else {
				if (!this._varMap[this._rootKey]) {
					this._varMap[this._rootKey] = [];
				}
				this._varMap[this._rootKey].push({ keyName: key, keyValue: obj[key] });
			}
		}

		return this._varMap;
	}

	/**
	 * Transforms the source and then runs it
	 * @param source
	 * @returns {null}
	 */
	protected evaluateSource(source:string) {
		source = this.transformSource(source);
		return this.runSource(source);
	}

	/**
	 * Transforms the source to ES2015
	 * @param source
	 * @returns {string}
	 */
	private transformSource(source:string) {
		// Transform source to es5
		return babel.transform(source, {
			ast: false,
			presets: [ 'es2015' ],
		}).code;
	}

	/**
	 * The source code is evaluated through the VM2 (sandbox) module
	 * @param source
	 * @returns {null}
	 */
	private runSource(source:string) {
		// Spawn a new vm
		const vm = new NodeVM();
		let vmScript = source;
		let compiledSource = null;

		try {
			vmScript = new VMScript(source);
		} catch (error) {
			console.error('Failed to compile script.');
			throw error;
		}

		try {
			compiledSource = vm.run(vmScript);
		} catch (error) {
			console.error('Failed to execute script.');
			throw error;
		}

		return compiledSource;
	}

	/**
	 * Returns the fileName
	 * @param filePath
	 * @returns {undefined|string}
	 */
	private getFileName(filePath:string) : string {
		return filePath.split(/\//).pop();
	}

	/**
	 * Read mustache template file
	 * @returns {Promise<any>}
	 */
	private async readTemplate() {
		const template = !this.templateFile ? this._defaultTemplate : this.templateFile;
		return pify(fs.readFile)(template, 'utf-8');
	}

	/**
	 * Write mustache template file
	 * @param templateData
	 * @returns {Promise<any>}
	 */
	private async writeTemplate(templateData:string) {
		const fileToWrite:()=>Promise<any> = () => pify(fs.writeFile)(this.file.dest, templateData, 'utf8');

		if (!this.file.disableDirectoryCreation) {
			await pify(mkdirp)(path.dirname(this.file.dest));
		}

		return fileToWrite();
	}

	/**
	 * Creation of mustache template
	 * @param jsObject
	 * @returns {Promise<void>}
	 */
	protected async createTemplate(jsObject:{[x:string]:string}) {
		const data = this.mapObject(jsObject);

		if (data) {
			const template = await this.readTemplate();
			const dataKeys = Object.keys(data);

			let processedTemplate:string = '';

			dataKeys.forEach((key, index) => {
				// Replace key with map-name/filename if exists (when doing a export default { ... })
				if (dataKeys.length === 1) {
					const keyCopy = key;
					key = this.file.mapName ? this.file.mapName : this.getFileName(this.file.dest).split('.')[0];
					// Create a new key and content with the new key name, remove the old key from object
					if (data.hasOwnProperty(keyCopy)) {
						data[key] = data[keyCopy];
						delete data[keyCopy];
					}
				}

				processedTemplate += template.replace(/__rootKey__/g, key);
				// Only add two newlines when we are not at EOF
				processedTemplate += (index + 1) === dataKeys.length ? "\n" : "\n\n";
			});


			await this.writeTemplate(mustache.render(processedTemplate, data));
		}
	}

	/**
	 * Abstract implementation of run
	 */
	abstract async run():Promise<any>;
}

export default AbstractParser;