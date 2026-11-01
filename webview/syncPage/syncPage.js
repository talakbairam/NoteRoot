// The Sync page. All texts and data come from the extension (see src/webview/syncMessages.ts);
// nothing is done from here: every button is a message, and the extension runs the command of the Actions view.
(function () {
	'use strict';

	const vscode = acquireVsCodeApi();
	const page = document.getElementById('page');

	let texts = null;
	/** The model of each service, by its id: every service of the sync has its own connection and changes. */
	let models = null;
	/** The model of the service that is open (or the first one, while the list of services is shown). */
	let model = null;
	let searchBox = null;
	let nav = null;
	let content = null;
	/** The section the page shows (kept when the tab is hidden and shown again). */
	let current = (vscode.getState() || {}).section || 'overview';
	/** The service that is open (its id), or null for the list of services, which is how the page starts. */
	let selected = null;
	let toolbar = null;

	function el(tag, className, text) {
		const created = document.createElement(tag);
		if (className) {
			created.className = className;
		}
		if (text !== undefined) {
			created.textContent = text;
		}
		return created;
	}

	function send(message) {
		vscode.postMessage(message);
	}

	/** A button that asks the extension to run one of the actions of the Actions view. */
	function button(label, action, className) {
		const created = el('button', className, label);
		created.type = 'button';
		created.disabled = model.busy;
		created.addEventListener('click', () => send({ type: 'action', action, provider: selected === null ? undefined : selected }));
		return created;
	}

	function capitalize(text) {
		return text.charAt(0).toUpperCase() + text.slice(1);
	}

	function section(id, title) {
		const created = el('section');
		created.dataset.section = id;
		created.append(el('h2', undefined, title));
		return created;
	}

	function overviewSection(providerId) {
		const view = section('overview', texts.overview);
		if (!model.connected || (providerId !== undefined && model.service.id !== providerId)) {
			view.append(el('h3', undefined, texts.notConnectedTitle), el('p', 'desc', texts.notConnectedHelp));
			const actions = el('div', 'actions');
			const connect = button(texts.connect, 'connect');
			actions.append(connect);
			view.append(actions);
			if (providerId === 'googledrive') {
				// The Google sign-in needs a client id and secret: say whether they are there, and how to make them if not.
				const missing = model.googleClient.missing;
				const from = { local: texts.googleClientFromLocal, config: texts.googleClientFromConfig, 'built-in': texts.googleClientFromBuiltIn };
				const none = missing.length === 2 ? texts.googleClientMissingBoth : missing[0] === 'id' ? texts.googleClientMissingId : texts.googleClientMissingSecret;
				actions.append(el('span', 'pill ' + (missing.length === 0 ? 'on' : 'warn'), missing.length === 0 ? from[model.googleClient.source] : none));
				if (missing.length > 0) {
					connect.disabled = true;
					view.append(googleClientHelp());
				}
			}
			if (providerId === 'github') {
				// Nothing to set up: the sign-in of VS Code. Say so, and what happens when Connect is pressed.
				actions.append(el('span', 'pill on', texts.githubUses));
				view.append(howTo(texts.githubHowTitle, ['githubStep1', 'githubStep2', 'githubStep3'], false));
			}
			if (providerId === 'gitlab') {
				// A token is asked at Connect: say whether one is saved, and how to make one if not.
				const saved = model.gitlab.tokenSaved;
				actions.append(el('span', 'pill ' + (saved ? 'on' : 'warn'), saved ? texts.gitlabTokenSaved.replace('{address}', model.gitlab.address) : texts.gitlabTokenMissing));
				if (!saved) {
					view.append(howTo(texts.gitlabHowTitle, ['gitlabStep1', 'gitlabStep2', 'gitlabStep3', 'gitlabStep4'], true));
				}
			}
			if (providerId === 'dropbox') {
				// The Dropbox sign-in needs the app key of the user's own app: say whether it is there, and how to make one if not.
				actions.append(el('span', 'pill ' + (model.dropboxKeySet ? 'on' : 'warn'), model.dropboxKeySet ? texts.dropboxKeySet : texts.dropboxKeyMissing));
				if (!model.dropboxKeySet) {
					connect.disabled = true;
					view.append(dropboxHelp());
				}
			}
			return view;
		}
		const service = model.service;
		const target = model.target;
		const status = model.state;
		const card = el('div', 'options');
		const statusLine = option(texts.status, status.detail ? status.text + ' ' + status.detail : status.text, undefined, status.tone, [button(texts.checkNow, 'refresh', 'secondary')]);
		// The colour of the sentence tells how things stand.
		statusLine.querySelector('.desc').classList.add('tone-' + status.tone);
		card.append(
			option(
				texts.service,
				service.label,
				undefined,
				'neutral',
				// A link to the repository or the folder in the browser (the address is made by the extension).
				service.canOpenOnline ? [button(texts.openOnline, 'openOnline', 'secondary')] : []
			),
			option(
				capitalize(service.targetNoun),
				target.detail ? target.label + ' (' + target.detail + ')' : target.label,
				target.isPrivate ? texts.privateText : texts.publicText,
				target.isPrivate ? 'neutral' : 'warn',
				[button(texts.change, 'changeTarget', 'secondary')]
			),
			statusLine
		);
		view.append(card);

		// What can be done now: one line for each action, with what it does and what is waiting for it, like the options.
		const parts = splitRows();
		const toPull = parts.pull.length;
		const toPush = parts.push.length;
		const conflicts = parts.conflicts.length;
		const doing = el('div', 'options');
		if (conflicts > 0) {
			// Only goes to the conflicts: the choices are made there, and nothing is asked in a pop-up.
			const fix = el('button', undefined, texts.fixConflicts);
			fix.type = 'button';
			fix.title = texts.fixConflictsTip;
			fix.addEventListener('click', () => {
				choose('changes');
				const block = document.getElementById('conflicts');
				if (block) {
					block.scrollIntoView({ block: 'start' });
				}
			});
			doing.append(option(texts.conflictsTitle, texts.fixConflictsHelp, texts.countConflicts.replace('{n}', String(conflicts)), 'warn', [fix]));
		}
		doing.append(
			option(
				texts.pull,
				texts.pullHelp,
				toPull > 0 ? texts.countToPull.replace('{n}', String(toPull)) : texts.nothingToPull,
				toPull > 0 ? 'warn' : 'neutral',
				[button(texts.pull, 'pull', toPull > 0 ? '' : 'secondary')]
			),
			option(
				texts.push,
				texts.pushHelp,
				toPush > 0 ? texts.countToPush.replace('{n}', String(toPush)) : texts.nothingToPush,
				toPush > 0 ? 'warn' : 'neutral',
				[button(texts.push, 'push', toPush > 0 ? '' : 'secondary')]
			),
			option(texts.disconnect, texts.disconnectHelp, undefined, 'neutral', [button(texts.disconnect, 'disconnect', 'secondary')])
		);
		view.append(el('h3', 'actions-title', texts.actionsTitle), doing);
		return view;
	}

	/** The steps to make a Google client, and a button that opens the settings where its id and secret go. */
	function googleClientHelp() {
		const box = el('div', 'listbox help');
		const head = el('div', 'listbox-head');
		head.append(el('h3', undefined, texts.googleClientHowTitle));
		const steps = el('ol', 'steps');
		for (const key of ['googleClientStep1', 'googleClientStep2', 'googleClientStep3', 'googleClientStep4', 'googleClientStep5', 'googleClientStep6', 'googleClientStep7', 'googleClientStep8']) {
			steps.append(el('li', undefined, texts[key]));
		}
		const actions = el('div', 'actions');
		actions.append(button(texts.openSyncSettings, 'openSyncSettings', 'secondary'));
		box.append(head, el('p', 'desc', texts.googleClientHowIntro), steps, actions);
		return box;
	}

	/** A box with a title and numbered steps, and (when `withSettings`) a button that opens the settings. */
	function howTo(title, keys, withSettings) {
		const box = el('div', 'listbox help');
		const head = el('div', 'listbox-head');
		head.append(el('h3', undefined, title));
		const steps = el('ol', 'steps');
		for (const key of keys) {
			steps.append(el('li', undefined, texts[key]));
		}
		box.append(head, steps);
		if (withSettings) {
			const actions = el('div', 'actions');
			actions.append(button(texts.openSyncSettings, 'openSyncSettings', 'secondary'));
			box.append(actions);
		}
		return box;
	}

	/** The steps to make a Dropbox app, and a button that opens the settings where its app key goes. */
	function dropboxHelp() {
		const box = el('div', 'listbox help');
		const head = el('div', 'listbox-head');
		head.append(el('h3', undefined, texts.dropboxHowTitle));
		const steps = el('ol', 'steps');
		for (const key of ['dropboxStep1', 'dropboxStep2', 'dropboxStep3', 'dropboxStep4']) {
			steps.append(el('li', undefined, texts[key]));
		}
		const actions = el('div', 'actions');
		actions.append(button(texts.openSyncSettings, 'openSyncSettings', 'secondary'));
		box.append(head, steps, actions);
		return box;
	}

	/** The files of one side. `known` is false when that side was not compared yet. */
	/** A file in conflict: which version to keep. The chosen one is marked; pressing it again takes the choice back. */
	function choiceButtons(entry) {
		const group = el('span', 'choice');
		group.setAttribute('role', 'group');
		const options = [
			['mine', texts.choiceMine, texts.choiceMineTip],
			['theirs', texts.choiceOnline, texts.choiceOnlineTip],
		];
		// Keeping both needs a file that changed on both sides, and is not the settings file of NoteRoot.
		if (entry.kind !== 'deleted' && entry.path !== '.noteroot/config.json') {
			options.push(['both', texts.choiceBoth, texts.choiceBothTip]);
		}
		for (const [resolution, label, tip] of options) {
			const choose = el('button', entry.choice === resolution ? 'selected' : '', label);
			choose.type = 'button';
			choose.title = tip;
			choose.setAttribute('aria-pressed', entry.choice === resolution ? 'true' : 'false');
			choose.addEventListener('click', () =>
				send({
					type: 'chooseConflict',
					path: entry.path,
					resolution: entry.choice === resolution ? 'ask' : resolution,
					provider: selected === null ? undefined : selected,
				})
			);
			group.append(choose);
		}
		return group;
	}

	function changeList(title, hint, rows, known, side, needle, emptyText, withChoice) {
		const block = el('div', 'listbox');
		const head = el('div', 'listbox-head');
		head.append(el('h3', undefined, title));
		if (known) {
			head.append(el('span', 'count', String(rows.length)));
		}
		block.append(head, el('p', 'desc', hint));
		if (!known) {
			block.append(el('p', 'empty', texts.notChecked));
			return block;
		}
		const shown = rows.filter((entry) => needle === '' || entry.path.toLowerCase().includes(needle));
		if (rows.length === 0) {
			block.append(el('p', 'empty', emptyText || texts.nothingNew));
		} else if (shown.length === 0) {
			block.append(el('p', 'empty', texts.noMatches));
		}
		for (const entry of shown) {
			const item = el('div', 'file');
			// The folder part of the path is quieter than the name of the file.
			const open = el('button', 'link');
			const cut = entry.path.lastIndexOf('/');
			if (cut >= 0) {
				open.append(el('span', 'dir', entry.path.slice(0, cut + 1)));
			}
			open.append(document.createTextNode(entry.path.slice(cut + 1)));
			open.type = 'button';
			open.addEventListener('click', () => send({ type: 'showChange', side, path: entry.path, kind: entry.kind, provider: selected === null ? undefined : selected }));
			item.append(open, el('span', 'kind ' + entry.kind, entry.kindText));
			if (withChoice) {
				// On a line of its own under the name, with what it is for.
				const row = el('div', 'choice-row');
				row.append(el('span', 'choice-label', texts.choiceLabel), choiceButtons(entry));
				item.append(row);
			}
			// The Diff button shows the difference whatever the kind of change (the name only opens the file or the online version).
			const diff = el('button', 'link diff', texts.diff);
			diff.type = 'button';
			diff.title = texts.diffTip;
			diff.addEventListener('click', () => send({ type: 'diffFile', path: entry.path, provider: selected === null ? undefined : selected }));
			item.append(diff);
			// A file that goes online sealed, or that is on the list of the files to encrypt while the target is not encrypted.
			if (entry.seal === 'encrypted') {
				item.append(el('span', 'seal ok', texts.sealEncrypted));
			} else if (entry.seal === 'listed-plain') {
				item.append(el('span', 'seal warn', texts.sealListedPlain));
			}
			if (entry.conflict) {
				item.append(el('span', 'badge', texts.conflict));
			}
			block.append(item);
		}
		return block;
	}

	/** A framed list with a title, a count and a short help: the entries of the list, or the notes it chooses. */
	function listBox(title, count, help, items, emptyText, more) {
		const box = el('div', 'listbox');
		const head = el('div', 'listbox-head');
		head.append(el('h3', undefined, title), el('span', 'count', count));
		box.append(head, el('p', 'desc', help));
		if (items.length === 0) {
			box.append(el('p', 'empty', emptyText));
			return box;
		}
		const list = el('ul', 'entries');
		for (const item of items) {
			list.append(el('li', undefined, item));
		}
		if (more) {
			list.append(el('li', 'more', texts.filesMore));
		}
		box.append(list);
		return box;
	}

	/** The notes of the folder that the list of the files to encrypt chooses. */
	function notesOnList(title) {
		return listBox(
			title,
			String(model.encryptedFiles.length) + (model.encryptedFilesMore ? '+' : ''),
			texts.filesHelp,
			model.encryptedFiles,
			texts.filesNone,
			model.encryptedFilesMore
		);
	}

	/** The conflicts: a bar to choose for all the files, a choice for each file, and a footer that applies the choices. */
	function conflictsBlock(conflicts, needle) {
		const block = changeList(texts.conflictsTitle, texts.conflictsHint, conflicts, model.compared && model.remoteCompared, 'local', needle, texts.noConflicts, true);
		block.id = 'conflicts';
		if (conflicts.length === 0) {
			return block;
		}
		const provider = selected === null ? undefined : selected;
		const chooseAll = (resolution) => {
			for (const entry of conflicts) {
				send({ type: 'chooseConflict', path: entry.path, resolution, provider });
			}
		};
		const plain = (label, tip, resolution) => {
			const created = el('button', 'secondary', label);
			created.type = 'button';
			created.title = tip;
			created.addEventListener('click', () => chooseAll(resolution));
			return created;
		};

		// Above the files: the same choice for all of them, in one click (the one for a single file is on its own line).
		const bar = el('div', 'conflict-bar');
		bar.append(
			el('span', 'conflict-bar-label', texts.chooseAllLabel),
			plain(texts.chooseAllMine, texts.choiceMineTip, 'mine'),
			plain(texts.chooseAllOnline, texts.choiceOnlineTip, 'theirs')
		);
		block.insertBefore(bar, block.children[2] || null);

		// Under the files: how many have a choice, and the button that puts the choices in effect.
		const chosen = conflicts.filter((entry) => entry.choice).length;
		const everyOne = chosen === conflicts.length;
		const footer = el('div', 'conflict-footer');
		const progress = el(
			'span',
			'conflict-progress' + (everyOne ? ' done' : ''),
			(everyOne ? '\u2713 ' : '') + texts.chosenCount.replace('{n}', String(chosen)).replace('{total}', String(conflicts.length))
		);
		const apply = button(texts.applyChoices, 'fixConflicts');
		apply.disabled = model.busy || !everyOne;
		apply.title = everyOne ? texts.applyChoicesTip : texts.chooseEveryFile;
		footer.append(progress, apply);
		block.append(footer);
		return block;
	}

	/** The changed files in three groups: what a push sends, what a pull brings, and what is in conflict (once). */
	function splitRows() {
		const conflicts = model.local.filter((entry) => entry.conflict);
		const known = new Set(conflicts.map((entry) => entry.path));
		// A conflict that only the remote list has (a file that was deleted here) is still a conflict.
		for (const entry of model.remote) {
			if (entry.conflict && !known.has(entry.path)) {
				conflicts.push(entry);
			}
		}
		return {
			push: model.local.filter((entry) => !entry.conflict),
			pull: model.remote.filter((entry) => !entry.conflict),
			conflicts,
		};
	}

	function changesSection(needle) {
		const view = section('changes', texts.changes);
		// A file that changed on both sides is only in the Conflicts: it is neither a push nor a pull until it is resolved.
		const parts = splitRows();
		view.append(
			changeList(texts.localChanges, texts.localHint, parts.push, model.compared, 'local', needle),
			changeList(texts.remoteChanges, texts.remoteHint, parts.pull, model.compared && model.remoteCompared, 'remote', needle),
			conflictsBlock(parts.conflicts, needle)
		);
		return view;
	}

	/** One option: the name and what it does on the left, its state (a small label) and the button that changes it on the right. */
	function option(name, description, state, tone, buttons, icon) {
		const item = el('div', 'option');
		const text = el('div', 'option-text');
		text.append(el('div', 'name', name), el('p', 'desc', description));
		if (icon) {
			// The icon sits left of the text; the text keeps its own column.
			const lead = el('div', 'option-lead');
			lead.append(icon, text);
			item.append(lead);
		} else {
			item.append(text);
		}
		const control = el('div', 'option-control');
		if (state !== undefined) {
			control.append(el('span', 'pill ' + tone, state));
		}
		control.append(...buttons);
		item.append(control);
		return item;
	}

	const SVG_NS = 'http://www.w3.org/2000/svg';
	/** Marks of the services (single-colour paths drawn with currentColor, except Drive's three colours). */
	function serviceIcon(id) {
		const svg = document.createElementNS(SVG_NS, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('class', 'service-icon');
		svg.setAttribute('aria-hidden', 'true');
		const path = (d, fill) => {
			const p = document.createElementNS(SVG_NS, 'path');
			p.setAttribute('d', d);
			p.setAttribute('fill', fill);
			svg.append(p);
		};
		if (id === 'dropbox') {
			path('M6 2 0 6l6 4 6-4zm12 0-6 4 6 4 6-4zM0 14l6 4 6-4-6-4zm18-4-6 4 6 4 6-4zM6 19.2l6 4 6-4-6-4z', '#0061FF');
		} else if (id === 'gitlab') {
			path('M12 22.5 1.6 14.4 4 5.6l2.6 6.9h10.8L20 5.6l2.4 8.8z', '#FC6D26');
		} else if (id === 'googledrive') {
			path('M8.2 3h7.6l6.2 10.8h-7.6z', '#FBBC04');
			path('M8.2 3L2 13.8l3.8 6.6L12 9.6z', '#0F9D58');
			path('M5.8 20.4h12.4l3.8-6.6H9.6z', '#4285F4');
		} else {
			path(
				'M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.18-3.08-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.59.23 2.76.11 3.05.74.8 1.18 1.82 1.18 3.08 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z',
				'currentColor'
			);
		}
		return svg;
	}

	/** What Push does with a marked file when the repository is not encrypted. */
	function markedOption() {
		const names = { ask: texts.markedAsk, plain: texts.markedPlain, skip: texts.markedSkip, encrypt: texts.markedEncrypt };
		// Sending a marked file readable is the one that needs care; leaving it out or encrypting it is safe.
		const tone = model.markedAction === 'plain' ? 'warn' : model.markedAction === 'ask' ? 'neutral' : 'on';
		return option(texts.markedAction, texts.markedActionHelp, names[model.markedAction], tone, [
			button(texts.change, 'markedAction', 'secondary'),
		]);
	}

	function optionsSection() {
		const view = section('options', texts.options);
		const list = el('div', 'options');
		if (model.service.canLimitHistory) {
			const history =
				model.keepLast === undefined
					? texts.historyAll
					: model.keepLast === 1
						? texts.historyOne
						: texts.historyLast.replace('{n}', String(model.keepLast));
			// Keeping fewer versions drops the older ones, so any limit is shown as a warning.
			list.append(
				option(texts.history, texts.historyHelp, history, model.keepLast === undefined ? 'neutral' : 'warn', [
					button(texts.change, 'history', 'secondary'),
				])
			);
		}
		list.append(
			option(texts.hiddenFiles, texts.hiddenFilesHelp, model.includeHidden ? texts.included : texts.leftOut, model.includeHidden ? 'on' : 'neutral', [
				button(texts.change, 'hidden', 'secondary'),
			])
		);
		view.append(list);
		return view;
	}

	/** What is the same for every service, in one place at the start: the check for news, the message of a push, the files to encrypt. */
	function sharedSection() {
		const view = el('div', 'shared');
		view.append(el('h3', 'actions-title', texts.sharedTitle), el('p', 'desc', texts.sharedHelp));
		const list = el('div', 'options');
		list.append(
			option(texts.autoCheck, texts.autoCheckHelp, model.autoCheck ? texts.on : texts.off, model.autoCheck ? 'on' : 'neutral', [
				button(model.autoCheck ? texts.turnOff : texts.turnOn, model.autoCheck ? 'autoCheckOff' : 'autoCheckOn', 'secondary'),
			]),
			// The message of a push: asked, or the default one without asking.
			option(
				texts.autoMessage,
				texts.autoMessageHelp.replace('{version}', texts.versionWord),
				model.autoMessage ? texts.autoMessageOn : texts.autoMessageOff,
				model.autoMessage ? 'on' : 'neutral',
				[button(model.autoMessage ? texts.turnOff : texts.turnOn, 'autoMessage', 'secondary')]
			),
			markedOption(),
			option(texts.filesToEncrypt, texts.filesToEncryptHelp.replace('{n}', String(model.encryptList.length)), undefined, 'neutral', [
				button(texts.editList, 'openEncryptList', 'secondary'),
			]),
			option(texts.filesNotSynced, texts.filesNotSyncedHelp.replace('{n}', String(model.ignoreList.length)), undefined, 'neutral', [
				button(texts.editList, 'openEncryptList', 'secondary'),
			])
		);
		view.append(list);
		if (model.ignoreList.length > 0) {
			view.append(listBox(texts.notSyncedBoxTitle, String(model.ignoreList.length), texts.notSyncedBoxHelp, model.ignoreList, texts.listEmpty, false));
		}
		if (model.encryptList.length > 0) {
			view.append(listBox(texts.listBoxTitle, String(model.encryptList.length), texts.listBoxHelp, model.encryptList, texts.listEmpty, false));
		}
		return view;
	}

	function encryptionSection() {
		const view = section('encryption', texts.encryption);
		const encryption = model.encryption;
		if (!encryption) {
			// {target} is the word of the service for what it keeps the notes in (repository, folder...).
			const state = el('div', 'options');
			state.append(
				option(texts.encryption, texts.notEncrypted.replace('{target}', model.service.targetNoun), texts.off, 'warn', [
					button(texts.encryptNow, 'encrypt', ''),
				])
			);
			view.append(state);
			// Notes already on the list of the files to encrypt: they go online readable until the repository is encrypted.
			if (model.encryptList.length > 0) {
				view.append(notesOnList(texts.filesListedTitle));
			}
			view.append(el('p', 'desc', texts.encryptHow), el('h3', undefined, texts.encryptAsksTitle));
			const asks = el('ul', 'steps');
			for (const key of ['encryptAsk1', 'encryptAsk2', 'encryptAsk3', 'encryptAsk4']) {
				asks.append(el('li', undefined, texts[key]));
			}
			view.append(asks, el('p', 'desc', texts.keyWarning));
			return view;
		}
		const custom = encryption.custom;
		const main = el('div', 'options');
		main.append(
			option(texts.encryption, texts.encrypted, texts.on, 'on', []),
			option(texts.masterKey, texts.masterKeyHelp, texts.keyState, 'neutral', [
				button(texts.changeKey, 'changeKey', 'secondary'),
				button(texts.forgetKey, 'forgetKey', 'secondary'),
			]),
			option(texts.turnOffEncryption, texts.turnOffEncryptionHelp, undefined, 'neutral', [
				button(texts.turnOffEncryptionButton, 'decryptRepository', 'secondary'),
			])
		);
		view.append(main);
		if (custom) {
			// The notes of the folder that the list chooses (the list itself is in the settings for all services).
			view.append(notesOnList(texts.filesTitle));
		}
		// The details that most people never change: closed until they are wanted.
		const more = document.createElement('details');
		more.className = 'advanced';
		more.append(el('summary', undefined, texts.advancedTitle));
		const extra = el('div', 'options');
		extra.append(
			option(
				texts.whichNotes,
				custom ? texts.scopeCustom.replace('{n}', String(model.encryptList.length)) : texts.scopeAll,
				custom ? texts.scopeCustomState : texts.scopeAllState,
				'neutral',
				custom ? [button(texts.editList, 'openEncryptList', 'secondary')] : []
			),
			option(
				texts.fileNames,
				encryption.names === 'hidden' ? texts.namesHidden : texts.namesPlain,
				encryption.names === 'hidden' ? texts.namesHiddenState : texts.namesKeptState,
				'neutral',
				[button(texts.change, 'changeNames', 'secondary')]
			)
		);
		more.append(extra);
		view.append(more);
		return view;
	}

	/** The list of services: each with its status, and a button that opens it. */
	function providersView() {
		const view = section('providers', texts.providersTitle);
		view.append(el('p', 'desc', texts.providersIntro));
		const list = el('div', 'options');
		for (const provider of model.providers) {
			const tone = provider.status.tone === 'ok' ? 'on' : provider.status.tone === 'off' ? 'neutral' : provider.status.tone === 'warn' ? 'warn' : 'neutral';
			// Opening a service is only the page changing: nothing is sent to the extension.
			const open = el('button', 'secondary', texts.providerOpen);
			open.type = 'button';
			open.addEventListener('click', () => openProvider(provider.id));
			list.append(option(provider.label, provider.summary, provider.status.text, tone, [open], serviceIcon(provider.id)));
		}
		// The same action for every connected service in one click, when at least one is connected.
		if (model.providers.some((provider) => provider.connected)) {
			const all = el('div', 'options all-actions');
			const check = button(texts.checkAll, 'refreshAll', 'secondary');
			check.title = texts.checkAllTip;
			const pull = button(texts.pullAll, 'pullAll', 'secondary');
			pull.title = texts.pullAllTip;
			const push = button(texts.pushAll, 'pushAll', 'secondary');
			push.title = texts.pushAllTip;
			all.append(option(texts.allTitle, texts.allHelp, undefined, 'neutral', [check, pull, push]));
			view.append(all);
		}
		// What is for all services only matters once a service is connected (the lists are also rows of the Settings page).
		view.append(list);
		if (model.providers.some((provider) => provider.connected)) {
			view.append(sharedSection());
		}
		return view;
	}

	function openProvider(id) {
		selected = id;
		current = 'overview';
		searchBox.value = '';
		render();
		window.scrollTo(0, 0);
	}

	function backToProviders() {
		selected = null;
		render();
		window.scrollTo(0, 0);
	}

	function choose(id) {
		current = id;
		vscode.setState({ section: id });
		searchBox.value = '';
		render();
		window.scrollTo(0, 0);
	}

	function addNav(id, label, count, isCurrent) {
		const created = el('button', 'nav-item');
		created.type = 'button';
		created.append(document.createTextNode(label));
		if (count !== undefined) {
			created.append(el('span', 'nav-count', String(count)));
		}
		created.setAttribute('aria-current', isCurrent ? 'true' : 'false');
		created.addEventListener('click', () => choose(id));
		nav.append(created);
	}

	/** Takes the model of the service that is open. */
	function useModel() {
		model = (selected !== null && models[selected]) || models[Object.keys(models)[0]];
	}

	function render() {
		useModel();
		content.textContent = '';
		nav.textContent = '';
		toolbar.hidden = true;
		if (model.problem) {
			content.append(el('p', 'notice', model.problem));
			return;
		}
		// The start: the list of the services, with their status.
		if (selected === null) {
			content.append(providersView());
			return;
		}
		const back = el('button', 'nav-item back', texts.backToProviders);
		back.type = 'button';
		back.addEventListener('click', backToProviders);
		nav.append(back);

		// A service of the sync. Only the one this folder is connected to has anything to show besides how to connect.
		const connectedHere = model.connected && model.service.id === selected;
		const ids = connectedHere ? ['overview', 'changes', 'options', 'encryption'] : ['overview'];
		if (!ids.includes(current)) {
			current = 'overview';
		}
		toolbar.hidden = !connectedHere;
		const needle = connectedHere ? searchBox.value.trim().toLowerCase() : '';
		// A search is about the files that changed, so it shows that section.
		const shown = needle !== '' ? 'changes' : current;
		const builders = {
			overview: () => overviewSection(selected),
			changes: () => changesSection(needle),
			options: optionsSection,
			encryption: encryptionSection,
		};
		// Which service this is: its mark and its name above every section.
		const open = model.providers.find((provider) => provider.id === selected);
		if (open) {
			const title = el('div', 'service-title');
			title.append(serviceIcon(open.id), el('span', undefined, open.label));
			content.append(title);
		}
		content.append(builders[shown]());
		if (connectedHere) {
			const parts = splitRows();
			const count = parts.push.length + parts.pull.length + parts.conflicts.length;
			for (const id of ids) {
				addNav(id, texts[id], id === 'changes' && model.compared ? count : undefined, id === shown);
			}
		}
	}

	function init(message) {
		texts = message.texts;
		models = message.models;
		useModel();
		page.textContent = '';
		page.append(el('h1', undefined, texts.title), el('p', 'intro', texts.intro));

		toolbar = el('div', 'toolbar');
		searchBox = el('input');
		searchBox.type = 'search';
		searchBox.placeholder = texts.searchPlaceholder;
		searchBox.setAttribute('aria-label', texts.searchLabel);
		searchBox.addEventListener('input', render);
		toolbar.append(searchBox);

		const layout = el('div', 'layout');
		nav = el('nav', 'nav');
		content = el('div', 'content');
		layout.append(nav, content);
		page.append(toolbar, layout);
		render();
	}

	window.addEventListener('message', (event) => {
		const message = event.data;
		if (!message || typeof message !== 'object') {
			return;
		}
		if (message.type === 'init') {
			init(message);
		} else if (message.type === 'update' && texts) {
			models = message.models;
			render();
		} else if (message.type === 'show' && texts && models && models[message.provider]) {
			// The extension sends the user to a section of a service (the conflicts of the changes).
			selected = message.provider;
			current = message.section;
			searchBox.value = '';
			render();
			const block = document.getElementById('conflicts');
			if (block) {
				block.scrollIntoView({ block: 'start' });
			}
		}
	});

	send({ type: 'ready' });
})();
