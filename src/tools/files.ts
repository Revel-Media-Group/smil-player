import sos from '@signageos/front-applet';
import * as _ from 'lodash';
import Debug from 'debug';

const debug = Debug('filesModule');
const isUrl = require('is-url-superb');

import { FileStructure } from '../enums';
import { CheckETagFunctions, SMILFileObject, SMILFile, SMILVideo, SMILImage, SMILWidget, SMILAudio } from '../models';
import { IStorageUnit } from '@signageos/front-applet/es6/FrontApplet/FileSystem/types';

export function getFileName(filePath: string) {
	return filePath.substring(filePath.lastIndexOf('/') + 1);
}

export async function extractWidgets(widgets: SMILWidget[], internalStorageUnit: IStorageUnit) {
	for (let i = 0; i < widgets.length; i++) {
		if (isUrl(widgets[i].src)) {
			debug(`Extracting widget: %O to destination path: %O`, widgets[i], `${FileStructure.extracted}${getFileName(widgets[i].src)}`);
			await sos.fileSystem.extractFile(
				{
					storageUnit: internalStorageUnit,
					filePath: `${FileStructure.widgets}${getFileName(widgets[i].src)}`
				},
				{
					storageUnit: internalStorageUnit,
					filePath: `${FileStructure.extracted}${getFileName(widgets[i].src)}`
				},
				'zip',
			);
		}
	}
}

export async function getFileDetails(media: SMILVideo | SMILImage | SMILWidget | SMILAudio, internalStorageUnit: IStorageUnit, fileStructure: string) {
	debug(`Getting file details for file: %O`, media);
	return sos.fileSystem.getFile({
		storageUnit: internalStorageUnit,
		filePath: `${fileStructure}${getFileName(media.src)}`
	})
}

export function parallelDownloadAllFiles(internalStorageUnit: IStorageUnit, filesList: any[], localFilePath: string): any[] {
	const promises: Promise<void>[] = [];
	for (let i = 0; i < filesList.length; i += 1) {
		if (isUrl(filesList[i].src)) {
			promises.push((async () => {
				debug(`Downloading file: %O`, filesList[i].src);
				await sos.fileSystem.downloadFile({
						storageUnit: internalStorageUnit,
						filePath: `${localFilePath}/${getFileName(filesList[i].src)}`
					},
					filesList[i].src,
				);
			})());
		}
	}
	return promises;
}

export async function checkFileEtag(internalStorageUnit: IStorageUnit, filesList: any[], localFilePath: string): Promise<any[]> {
	let promises: Promise<void>[] = [];
	for (let i = 0; i < filesList.length; i += 1) {
		if (isUrl(filesList[i].src)) {
			const response = await fetch(filesList[i].src, {
				method: 'HEAD',
				headers: {
					Accept: 'application/json',
				},
			});
			const newEtag = await response.headers.get('ETag');
			if (_.isNil(filesList[i].etag)) {
				filesList[i].etag = newEtag;
			}

			if (filesList[i].etag != newEtag) {
				debug(`New version of file detected: %O`, filesList[i].src);
				promises = promises.concat(parallelDownloadAllFiles(internalStorageUnit, [filesList[i]], localFilePath));
			}
		}
	}
	return promises;
}

export async function createFileStructure(internalStorageUnit: IStorageUnit) {
	for (const path of Object.values(FileStructure)) {
		if (await sos.fileSystem.exists({
			storageUnit: internalStorageUnit,
			filePath: path
		})) {
			debug(`Filepath already exists, deleting: %O`, path);
			await sos.fileSystem.deleteFile({
				storageUnit: internalStorageUnit,
				filePath: path
			}, true);
		}
		debug(`Create directory structure: %O`, path);
		await sos.fileSystem.createDirectory({
			storageUnit: internalStorageUnit,
			filePath: path
		});
	}
}

export async function prepareDownloadMediaSetup(internalStorageUnit: IStorageUnit, smilObject: SMILFileObject): Promise<any[]> {
	let downloadPromises: Promise<void>[] = [];
	// remove intro video, it was already downloaded
	smilObject.video.splice(0, 1);
	debug(`Starting to download files %O:`, smilObject);
	downloadPromises = downloadPromises.concat(parallelDownloadAllFiles(internalStorageUnit, smilObject.video, FileStructure.videos));
	downloadPromises = downloadPromises.concat(parallelDownloadAllFiles(internalStorageUnit, smilObject.audio, FileStructure.audios));
	downloadPromises = downloadPromises.concat(parallelDownloadAllFiles(internalStorageUnit, smilObject.img, FileStructure.images));
	downloadPromises = downloadPromises.concat(parallelDownloadAllFiles(internalStorageUnit, smilObject.ref, FileStructure.widgets));
	return downloadPromises;
}

export async function prepareETagSetup(internalStorageUnit: IStorageUnit, smilObject: SMILFileObject, SMILFile: SMILFile): Promise<CheckETagFunctions> {
	let fileEtagPromisesMedia: Promise<any>[] = [];
	let fileEtagPromisesSMIL: Promise<any>[] = [];
	debug(`Starting to check files for updates %O:`, smilObject);
	fileEtagPromisesMedia = fileEtagPromisesMedia.concat(checkFileEtag(internalStorageUnit, smilObject.video, FileStructure.videos));
	fileEtagPromisesMedia = fileEtagPromisesMedia.concat(checkFileEtag(internalStorageUnit, smilObject.audio, FileStructure.audios));
	fileEtagPromisesMedia = fileEtagPromisesMedia.concat(checkFileEtag(internalStorageUnit, smilObject.img, FileStructure.images));
	fileEtagPromisesMedia = fileEtagPromisesMedia.concat(checkFileEtag(internalStorageUnit, smilObject.ref, FileStructure.widgets));

	fileEtagPromisesSMIL = fileEtagPromisesSMIL.concat(checkFileEtag(internalStorageUnit, [SMILFile], FileStructure.rootFolder));

	return {
		fileEtagPromisesMedia,
		fileEtagPromisesSMIL,
	}
}
