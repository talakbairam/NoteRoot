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
	let nav = null;
	/** The section the page shows (kept when the tab is hidden and shown again). A search shows every section with a match. */
	let current = (vscode.getState() || {}).section || 'categories';

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

	/** The line of a switch: what it does on the left, the switch on the right, in a frame like the other lines. */
	function switchLine(hint, control) {
		const item = el('div', 'item');
		const head = el('div', 'item-head');
		const main = el('div', 'item-main');
		main.append(el('span', 'hint-text', hint));
		const actions = el('div', 'actions');
		actions.append(control);
		head.append(main, actions);
		item.append(head);
		return framed([item]);
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
		const rows = [];
		for (const entry of items) {
			const row = el('div', 'item');
			const head = el('div', 'item-head');
			const main = el('div', 'item-main');
			main.append(el('span', 'name', entry.label));
			main.append(link(entry.path, () => send({ type: 'openFile', path: entry.path })));
			head.append(main);
			row.append(head);
			rows.push(row);
		}
		box.append(framed(rows));
		if (truncated) {
			box.append(el('p', 'hint', texts.everyFileMore));
		}
		return box;
	}

	/** The lines of a section in one frame; nothing (no empty frame) when there are none. */
	function framed(rows) {
		const frame = el('div', 'options');
		frame.append(...rows);
		frame.hidden = rows.length === 0;
		return frame;
	}

	function choose(id) {
		current = id;
		vscode.setState({ section: id });
		searchBox.value = '';
		render();
		window.scrollTo(0, 0);
	}

	function render() {
		content.textContent = '';
		nav.textContent = '';
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
		const built = [];

		if (!model.advanced) {
			content.append(el('p', 'notice', texts.needsAdvanced));
		}

		// Categories
		const categories = model.categories.filter((c) => matches(needle, c.name, c.file, c.keyword));
		const categorySection = el('section');
		categorySection.dataset.section = 'categories';
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
		categorySection.append(framed(categories.map(categoryRow)));
		built.push({ id: 'categories', label: texts.categories, total: model.categories.length, matched: categories.length, section: categorySection });

		// Every file
		const everyFileSection = el('section');
		everyFileSection.dataset.section = 'everyFile';
		const everyFile = model.autoCategories
			? model.everyFile.filter((entry) => matches(needle, entry.label, entry.path))
			: [];
		everyFileSection.append(
			sectionHead(texts.everyFile, model.autoCategories ? model.everyFile.length : undefined),
			switchLine(texts.everyFileHint, switchBox(texts.everyFileSwitch, model.autoCategories, 'autoCategories'))
		);
		if (model.autoCategories) {
			everyFileSection.append(everyFileRows(everyFile, model.everyFileTruncated));
		}
		built.push({ id: 'everyFile', label: texts.everyFile, total: model.autoCategories ? model.everyFile.length : undefined, matched: everyFile.length, section: everyFileSection });

		// Tags
		const tags = model.tags.filter((t) => matches(needle, t.name, t.keyword));
		const tagSection = el('section');
		tagSection.dataset.section = 'tags';
		tagSection.append(
			sectionHead(texts.tags, model.tags.length, addButton(texts.newTag, { type: 'create', kind: 'tag' }))
		);
		if (model.tags.length === 0) {
			tagSection.append(el('p', 'empty', texts.noTags));
		}
		tagSection.append(framed(tags.map(tagRow)));
		built.push({ id: 'tags', label: texts.tags, total: model.tags.length, matched: tags.length, section: tagSection });

		// Tag patterns
		const patterns = model.patterns.filter((p) => matches(needle, p.pattern));
		const patternSection = el('section');
		patternSection.dataset.section = 'patterns';
		patternSection.append(
			sectionHead(texts.patterns, model.patterns.length, addButton(texts.newPattern, { type: 'pattern', action: 'add' })),
			switchLine(texts.patternsHint, switchBox(texts.patternsSwitch, model.autoTagPatterns, 'autoTagPatterns'))
		);
		if (model.patterns.length === 0) {
			patternSection.append(el('p', 'empty', texts.noPatterns));
		}
		patternSection.append(framed(patterns.map(patternRow)));
		built.push({ id: 'patterns', label: texts.patterns, total: model.patterns.length, matched: patterns.length, section: patternSection });

		// Without a search the chosen section shows; with one, every section that has a match (and the menu lists only those).
		const filtering = needle !== '';
		if (!built.some((entry) => entry.id === current)) {
			current = built[0].id;
		}
		for (const entry of built) {
			const visible = filtering ? entry.matched > 0 : entry.id === current;
			if (visible) {
				content.append(entry.section);
			}
			if (!filtering || entry.matched > 0) {
				const button = el('button', 'nav-item');
				button.type = 'button';
				button.append(document.createTextNode(entry.label));
				if (entry.total !== undefined) {
					button.append(el('span', 'nav-count', String(entry.total)));
				}
				button.setAttribute('aria-current', !filtering && entry.id === current ? 'true' : 'false');
				button.addEventListener('click', () => choose(entry.id));
				nav.append(button);
			}
		}
		if (filtering && !built.some((entry) => entry.matched > 0)) {
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
			model = message.model;
			render();
		}
	});

	send({ type: 'ready' });
})();
