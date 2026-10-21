// The Tags & Categories page. All texts and data come from the extension (see src/webview/labelsMessages.ts);
// nothing is written from here: every change is a message, and the extension asks, checks and saves.
(function () {
	'use strict';

	const vscode = acquireVsCodeApi();
	const page = document.getElementById('page');

	let texts = null;
	let model = null;
	/** Keys of the rows that are open, so a new model (a change anywhere) does not close them. */
	const openKeys = new Set();
	let searchBox = null;
	let content = null;

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

	/** A text button that looks like a link. */
	function link(label, onClick, className) {
		const button = el('button', 'link' + (className ? ' ' + className : ''), label);
		button.type = 'button';
		button.addEventListener('click', onClick);
		return button;
	}

	function count(number, one, many) {
		return number === 1 ? one : many.replace('{n}', String(number));
	}

	const notesText = (number) => count(number, texts.noteOne, texts.noteMany);
	const tagsText = (number) => count(number, texts.tagOne, texts.tagMany);

	/** A row that can be opened: the arrow and the key of the open state. */
	function toggle(key, children, hasChildren) {
		const button = el('button', 'toggle' + (hasChildren ? '' : ' none'));
		button.type = 'button';
		button.setAttribute('aria-expanded', String(openKeys.has(key)));
		button.tabIndex = hasChildren ? 0 : -1;
		button.addEventListener('click', () => {
			const open = !openKeys.has(key);
			if (open) {
				openKeys.add(key);
			} else {
				openKeys.delete(key);
			}
			button.setAttribute('aria-expanded', String(open));
			children.hidden = !open;
		});
		children.hidden = !openKeys.has(key);
		return button;
	}

	function noteLinks(notes) {
		const box = el('div', 'children');
		for (const note of notes) {
			const row = el('div', 'sub');
			row.append(link(note.path + ':' + note.line, () => send({ type: 'openNote', id: note.id })));
			box.append(row);
		}
		return box;
	}

	function matches(needle, ...parts) {
		return needle === '' || parts.some((part) => part && part.toLowerCase().includes(needle));
	}

	function sectionHead(title, total, ...extra) {
		const head = el('div', 'section-head');
		head.append(el('h2', undefined, title));
		if (total !== undefined) {
			head.append(el('span', 'count', String(total)));
		}
		head.append(el('span', 'spacer'), ...extra);
		return head;
	}

	function switchBox(label, on, id) {
		const wrapper = el('label', 'switch');
		const box = el('input');
		box.type = 'checkbox';
		box.checked = on;
		box.addEventListener('change', () => send({ type: 'switch', id, on: box.checked }));
		wrapper.append(box, document.createTextNode(label));
		return wrapper;
	}

	function addButton(label, message) {
		const button = el('button', 'secondary', label);
		button.type = 'button';
		button.addEventListener('click', () => send(message));
		return button;
	}

	function entryActions(kind, name, buttons) {
		const actions = el('div', 'actions');
		for (const [label, action, danger] of buttons) {
			actions.append(link(label, () => send({ type: 'entry', action, kind, name }), danger ? 'danger' : ''));
		}
		return actions;
	}

	function keywordBadge(keyword) {
		return keyword ? el('span', 'badge', texts.keyword + ': ' + keyword) : null;
	}

	function categoryRow(category) {
		const item = el('div', 'item');
		const head = el('div', 'item-head');
		const key = 'category:' + category.name;
		const children = el('div', 'children');
		const file = category.file || model.quickNoteFile;
		const exists = category.file ? category.fileExists : model.quickNoteFileExists;
		const fileRow = el('div', 'sub');
		if (exists) {
			fileRow.append(link(file, () => send({ type: 'openFile', path: file })));
		} else {
			fileRow.append(el('span', undefined, file), el('span', 'meta', ' · ' + texts.notCreated));
		}
		children.append(fileRow);

		const main = el('div', 'item-main');
		main.append(el('span', 'name', category.name));
		main.append(el('span', 'meta', category.file ? category.file : texts.usesQuickNoteFile));
		const badge = keywordBadge(category.keyword);
		if (badge) {
			main.append(badge);
		}
		const buttons = [[texts.changeFile, 'file']];
		if (category.file) {
			buttons.push([texts.removeFile, 'removeFile']);
		}
		buttons.push([texts.setKeyword, 'keyword']);
		if (category.keyword) {
			buttons.push([texts.removeKeyword, 'removeKeyword']);
		}
		buttons.push([texts.rename, 'rename'], [texts.delete, 'delete', true]);
		head.append(toggle(key, children, true), main, entryActions('category', category.name, buttons));
		item.append(head, children);
		return item;
	}

	function tagRow(tag) {
		const item = el('div', 'item');
		const head = el('div', 'item-head');
		const notes = tag.notes;
		const children = notes ? noteLinks(notes) : el('div', 'children');
		const main = el('div', 'item-main');
		main.append(el('span', 'name', '#' + tag.name));
		main.append(el('span', 'meta', notes ? notesText(notes.length) : texts.counting));
		const badge = keywordBadge(tag.keyword);
		if (badge) {
			main.append(badge);
		}
		const buttons = [[texts.setKeyword, 'keyword']];
		if (tag.keyword) {
			buttons.push([texts.removeKeyword, 'removeKeyword']);
		}
		buttons.push([texts.rename, 'rename'], [texts.delete, 'delete', true]);
		head.append(
			toggle('tag:' + tag.name, children, !!notes && notes.length > 0),
			main,
			entryActions('tag', tag.name, buttons)
		);
		item.append(head, children);
		return item;
	}

	function patternRow(pattern) {
		const item = el('div', 'item');
		const head = el('div', 'item-head');
		const found = pattern.tags;
		const children = el('div', 'children');
		if (found && found.length === 0) {
			children.append(el('div', 'meta', texts.noMatchesYet));
		} else if (found) {
			for (const tag of found) {
				const row = el('div', 'sub');
				const key = 'pattern:' + pattern.pattern + ':' + tag.name.toLowerCase();
				const notes = noteLinks(tag.notes);
				const line = el('div', 'item-head');
				const main = el('div', 'item-main');
				main.append(el('span', 'name', '#' + tag.name), el('span', 'meta', notesText(tag.notes.length)));
				line.append(toggle(key, notes, tag.notes.length > 0), main);
				row.append(line, notes);
				children.append(row);
			}
		}
		const main = el('div', 'item-main');
		main.append(el('span', 'name', pattern.pattern));
		main.append(el('span', 'meta', found ? tagsText(found.length) : texts.counting));
		const actions = el('div', 'actions');
		actions.append(
			link(texts.edit, () => send({ type: 'pattern', action: 'edit', pattern: pattern.pattern })),
			link(texts.delete, () => send({ type: 'pattern', action: 'delete', pattern: pattern.pattern }), 'danger')
		);
		head.append(toggle('pattern:' + pattern.pattern, children, true), main, actions);
		item.append(head, children);
		return item;
	}

	function everyFileRows(items, truncated) {
		const box = el('div');
		if (items.length === 0) {
			box.append(el('p', 'empty', texts.everyFileNone));
			return box;
		}
		for (const entry of items) {
			const row = el('div', 'item');
			const head = el('div', 'item-head');
			const main = el('div', 'item-main');
			main.append(el('span', 'name', entry.label));
			main.append(link(entry.path, () => send({ type: 'openFile', path: entry.path })));
			head.append(main);
			row.append(head);
			box.append(row);
		}
		if (truncated) {
			box.append(el('p', 'hint', texts.everyFileMore));
		}
		return box;
	}

	function render() {
		content.textContent = '';
		if (model.problem) {
			const problem = el('div', 'problem');
			const button = el('button', 'secondary', texts.selectFolder);
			button.type = 'button';
			button.addEventListener('click', () => send({ type: 'selectRoot' }));
			problem.append(el('p', undefined, model.problem), button);
			content.append(problem);
			return;
		}
		const needle = searchBox.value.trim().toLowerCase();
		let shown = 0;

		if (!model.advanced) {
			content.append(el('p', 'notice', texts.needsAdvanced));
		}

		// Categories
		const categories = model.categories.filter((c) => matches(needle, c.name, c.file, c.keyword));
		const categorySection = el('section');
		categorySection.append(
			sectionHead(
				texts.categories,
				model.categories.length,
				addButton(texts.newCategory, { type: 'create', kind: 'category' })
			)
		);
		if (model.categories.length === 0) {
			categorySection.append(el('p', 'empty', texts.noCategories));
		}
		for (const category of categories) {
			categorySection.append(categoryRow(category));
		}
		shown += categories.length;
		content.append(categorySection);

		// Every file
		const everyFileSection = el('section');
		const everyFile = model.autoCategories
			? model.everyFile.filter((entry) => matches(needle, entry.label, entry.path))
			: [];
		everyFileSection.append(
			sectionHead(
				texts.everyFile,
				model.autoCategories ? model.everyFile.length : undefined,
				switchBox(texts.everyFileSwitch, model.autoCategories, 'autoCategories')
			),
			el('p', 'hint', texts.everyFileHint)
		);
		if (model.autoCategories) {
			everyFileSection.append(everyFileRows(everyFile, model.everyFileTruncated));
		}
		shown += everyFile.length;
		content.append(everyFileSection);

		// Tags
		const tags = model.tags.filter((t) => matches(needle, t.name, t.keyword));
		const tagSection = el('section');
		tagSection.append(
			sectionHead(texts.tags, model.tags.length, addButton(texts.newTag, { type: 'create', kind: 'tag' }))
		);
		if (model.tags.length === 0) {
			tagSection.append(el('p', 'empty', texts.noTags));
		}
		for (const tag of tags) {
			tagSection.append(tagRow(tag));
		}
		shown += tags.length;
		content.append(tagSection);

		// Tag patterns
		const patterns = model.patterns.filter((p) => matches(needle, p.pattern));
		const patternSection = el('section');
		patternSection.append(
			sectionHead(
				texts.patterns,
				model.patterns.length,
				switchBox(texts.patternsSwitch, model.autoTagPatterns, 'autoTagPatterns'),
				addButton(texts.newPattern, { type: 'pattern', action: 'add' })
			),
			el('p', 'hint', texts.patternsHint)
		);
		if (model.patterns.length === 0) {
			patternSection.append(el('p', 'empty', texts.noPatterns));
		}
		for (const pattern of patterns) {
			patternSection.append(patternRow(pattern));
		}
		shown += patterns.length;
		content.append(patternSection);

		if (needle !== '' && shown === 0) {
			content.append(el('p', 'empty', texts.noMatches));
		}
	}

	function init(message) {
		texts = message.texts;
		model = message.model;
		page.textContent = '';
		page.append(el('h1', undefined, texts.title), el('p', 'intro', texts.intro));

		const toolbar = el('div', 'toolbar');
		searchBox = el('input');
		searchBox.type = 'search';
		searchBox.placeholder = texts.searchPlaceholder;
		searchBox.setAttribute('aria-label', texts.searchLabel);
		searchBox.addEventListener('input', render);
		const refresh = el('button', 'secondary', texts.refresh);
		refresh.type = 'button';
		refresh.addEventListener('click', () => send({ type: 'refresh' }));
		toolbar.append(searchBox, refresh);
		content = el('div');
		page.append(toolbar, content);
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
			model = message.model;
			render();
		}
	});

	send({ type: 'ready' });
})();
