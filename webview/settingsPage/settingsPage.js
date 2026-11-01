// The Settings page. All texts and values come from the extension (see src/webview/settingsMessages.ts);
// nothing is written to the settings from here: every change is a message that the extension checks and saves.
(function () {
	'use strict';

	const vscode = acquireVsCodeApi();
	const page = document.getElementById('page');

	/** Texts from the extension, set by `init`. */
	let texts = null;
	/** The rows as built: id -> { row, def, ... controls }. */
	const rows = new Map();
	let searchBox = null;
	let changedBox = null;
	let nothing = null;
	/** The nav buttons by section id, and the section the page shows (kept when the page is hidden and shown again). */
	const navButtons = new Map();
	let current = (vscode.getState() || {}).section || null;

	function element(tag, className, text) {
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

	/** The entries of a list as lines: empty lines are dropped, the spaces of the others are kept. */
	function entriesOf(textarea) {
		return textarea.value.split(/\r?\n/).filter((line) => line !== '');
	}

	function build(rowData) {
		const item = { data: rowData };
		const row = element('div', 'row');
		row.dataset.id = rowData.id;
		row.classList.add('kind-' + rowData.kind);
		item.row = row;

		const head = element('div', 'head');
		const name = element('label', 'name', rowData.label);
		item.changedBadge = element('span', 'badge', texts.changed);
		item.sourceBadge = element('span', 'badge');
		head.append(name, item.changedBadge, item.sourceBadge);

		const description = element('p', 'desc', rowData.description);
		const control = element('div', 'control');
		const controlId = 'control-' + rowData.id;
		name.htmlFor = controlId;

		switch (rowData.kind) {
			case 'choice': {
				const select = element('select');
				select.id = controlId;
				for (const choice of rowData.choices || []) {
					const option = element('option', undefined, choice.label);
					option.value = choice.value;
					select.append(option);
				}
				select.addEventListener('change', () => send({ type: 'edit', id: rowData.id, value: select.value }));
				item.input = select;
				control.append(select);
				break;
			}
			case 'switch':
			case 'toggle': {
				const box = element('input');
				box.type = 'checkbox';
				box.id = controlId;
				const state = element('span', 'value-text');
				box.addEventListener('change', () => {
					state.textContent = box.checked ? texts.on : texts.off;
					send({ type: 'edit', id: rowData.id, value: box.checked });
				});
				item.input = box;
				item.state = state;
				control.append(box, state);
				break;
			}
			case 'text':
			case 'number': {
				const input = element('input');
				// A password is hidden, and it is never sent to the page: the box starts empty and only takes a new one.
				input.type = rowData.secret ? 'password' : 'text';
				if (rowData.secret) {
					input.autocomplete = 'off';
				}
				input.id = controlId;
				input.spellcheck = false;
				if (rowData.kind === 'number') {
					input.inputMode = 'decimal';
				}
				// `change` fires when the box is left or Enter is pressed, so a half typed value is never sent.
				input.addEventListener('change', () => send({ type: 'edit', id: rowData.id, value: input.value }));
				item.input = input;
				control.append(input);
				if (rowData.unit) {
					control.append(element('span', 'unit', rowData.unit));
				}
				break;
			}
			case 'list': {
				control.classList.add('list');
				const box = element('div', 'list-box');
				const area = element('textarea');
				area.id = controlId;
				area.spellcheck = false;
				area.wrap = 'off';
				const apply = element('button', undefined, texts.apply);
				apply.disabled = true;
				const hint = element('span', 'hint', texts.listHint);
				const submit = () => send({ type: 'edit', id: rowData.id, value: entriesOf(area) });
				area.addEventListener('input', () => {
					apply.disabled = false;
					area.rows = Math.min(Math.max(entriesOf(area).length + 1, 3), 12);
				});
				area.addEventListener('keydown', (event) => {
					if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
						event.preventDefault();
						submit();
					}
				});
				apply.addEventListener('click', submit);
				item.input = area;
				item.apply = apply;
				box.append(area);
				control.append(box, apply, hint);
				break;
			}
			case 'status': {
				// Only shows what is there; Reset (below) takes it away. A status that is a list also has a Forget for each item.
				item.valueText = element('span', 'value-text');
				control.append(item.valueText);
				if (rowData.items !== undefined) {
					item.list = element('ul', 'saved-items');
				}
				break;
			}
			default: {
				// An action: the value is shown, and a button runs the command that changes it.
				item.valueText = element('span', 'value-text');
				const change = element('button', 'secondary', texts.change);
				change.addEventListener('click', () => send({ type: 'action', id: rowData.id }));
				control.append(item.valueText, change);
			}
		}

		const meta = element('div', 'meta');
		item.defaultText = element('span');
		item.reset = element('button', 'link', texts.reset);
		item.reset.addEventListener('click', () => send({ type: 'reset', id: rowData.id }));
		item.saved = element('span', 'saved', texts.saved);
		item.saved.hidden = true;
		meta.append(item.defaultText, item.reset, item.saved);

		item.error = element('p', 'error');
		item.error.setAttribute('role', 'alert');
		item.error.hidden = true;

		row.append(head, description, control);
		if (item.list) {
			row.append(item.list);
		}
		row.append(meta, item.error);
		return item;
	}

	/** Shows the values of `rowData` in its row. A box that has the focus (or a list being edited) is left alone. */
	function refresh(item, rowData) {
		item.data = rowData;
		item.row.classList.toggle('changed', rowData.changed);
		item.changedBadge.hidden = !rowData.changed;
		const source =
			rowData.source === 'folder' ? texts.sourceFolder : rowData.source === 'user' ? texts.sourceUser : '';
		item.sourceBadge.textContent = source;
		item.sourceBadge.hidden = source === '';
		item.defaultText.textContent = texts.defaultLabel + ' ' + rowData.defaultText;
		item.reset.hidden = !(rowData.changed && rowData.resettable);

		const input = item.input;
		if (!input) {
			item.valueText.textContent = rowData.valueText;
			if (item.list) {
				// What is saved: its name, what it belongs to, and a button that forgets that one.
				item.list.textContent = '';
				for (const saved of rowData.items || []) {
					const line = element('li');
					const text = element('span', 'saved-text');
					text.append(element('span', undefined, saved.text), element('span', 'saved-detail', saved.detail));
					const forget = element('button', 'secondary', texts.forgetKey);
					forget.addEventListener('click', () => send({ type: 'forget', id: rowData.id, item: saved.id }));
					line.append(text, forget);
					item.list.append(line);
				}
			}
			return;
		}
		const editing = document.activeElement === input;
		if (rowData.kind === 'switch' || rowData.kind === 'toggle') {
			input.checked = rowData.value === true;
			item.state.textContent = input.checked ? texts.on : texts.off;
		} else if (rowData.kind === 'list') {
			if (!editing || item.apply.disabled) {
				input.value = rowData.value.join('\n');
				input.rows = Math.min(Math.max(rowData.value.length + 1, 3), 12);
				item.apply.disabled = true;
			}
		} else if (!editing) {
			input.value = String(rowData.value);
		}
	}

	function applyFilter() {
		const needle = searchBox.value.trim().toLowerCase();
		const onlyChanged = changedBox.checked;
		let shown = 0;
		for (const item of rows.values()) {
			const matches =
				(!onlyChanged || item.data.changed) &&
				(needle === '' || (item.data.label + ' ' + item.data.description).toLowerCase().includes(needle));
			item.row.hidden = !matches;
			shown += matches ? 1 : 0;
		}
		const filtering = needle !== '' || onlyChanged;
		for (const section of page.querySelectorAll('section')) {
			const id = section.dataset.section;
			const hasMatch = section.dataset.tools
				? !filtering // The buttons of the tools section are not settings: a search or "Only changed" hides them.
				: section.querySelectorAll('.row:not([hidden])').length > 0;
			// Without a filter only the chosen section shows; with one, every section that has a match.
			section.hidden = filtering ? !hasMatch : id !== current;
			const button = navButtons.get(id);
			if (button) {
				button.hidden = filtering && !hasMatch;
				button.setAttribute('aria-current', !filtering && id === current ? 'true' : 'false');
			}
		}
		// A heading goes away with its settings: a box with nothing that matches is hidden.
		for (const block of page.querySelectorAll('.subgroup')) {
			block.hidden = block.querySelectorAll('.row:not([hidden])').length === 0;
		}
		nothing.hidden = !filtering || shown !== 0;
	}

	function choose(id) {
		current = id;
		vscode.setState({ section: id });
		searchBox.value = '';
		changedBox.checked = false;
		applyFilter();
		window.scrollTo(0, 0);
	}

	function addNav(nav, id, label) {
		const button = element('button', 'nav-item', label);
		button.type = 'button';
		button.addEventListener('click', () => choose(id));
		navButtons.set(id, button);
		nav.append(button);
	}

	function init(message) {
		texts = message.texts;
		page.textContent = '';
		rows.clear();

		page.append(element('h1', undefined, texts.title), element('p', 'intro', texts.intro));

		const toolbar = element('div', 'toolbar');
		searchBox = element('input');
		searchBox.type = 'search';
		searchBox.placeholder = texts.searchPlaceholder;
		searchBox.setAttribute('aria-label', texts.searchLabel);
		searchBox.addEventListener('input', applyFilter);
		const changedLabel = element('label');
		changedBox = element('input');
		changedBox.type = 'checkbox';
		changedBox.addEventListener('change', applyFilter);
		changedLabel.append(changedBox, document.createTextNode(texts.onlyChanged));
		toolbar.append(searchBox, changedLabel);
		page.append(toolbar);

		navButtons.clear();
		const layout = element('div', 'layout');
		const nav = element('nav', 'nav');
		const content = element('div', 'content');
		layout.append(nav, content);
		page.append(layout);
		const sections = new Map();
		for (const rowData of message.rows) {
			let section = sections.get(rowData.group);
			if (!section) {
				section = element('section');
				section.dataset.section = rowData.group;
				section.append(element('h2', undefined, rowData.groupLabel));
				if (rowData.group === 'advanced') {
					section.append(element('p', 'desc', texts.advancedNote));
				}
				sections.set(rowData.group, section);
				content.append(section);
				addNav(nav, rowData.group, rowData.groupLabel);
			}
			// A heading inside the section starts a box of its own (a section without headings has one box).
			const heading = rowData.subgroup || '';
			if (section.lastHeading !== heading || !section.box) {
				const block = element('div', 'subgroup');
				if (heading) {
					block.append(element('h3', undefined, heading));
				}
				section.box = element('div', 'rows');
				block.append(section.box);
				section.append(block);
				section.lastHeading = heading;
			}
			const item = build(rowData);
			rows.set(rowData.id, item);
			section.box.append(item.row);
			refresh(item, rowData);
		}
		// Files and logs: the same buttons as the menu of the Settings view. They run commands, they change no setting.
		const tools = element('section');
		tools.dataset.tools = 'true';
		tools.dataset.section = 'tools';
		tools.append(element('h2', undefined, texts.toolsTitle));
		for (const tool of texts.tools) {
			const row = element('div', 'row');
			const head = element('div', 'head');
			head.append(element('span', 'name', tool.label));
			const control = element('div', 'control');
			const button = element('button', 'secondary', tool.button);
			button.addEventListener('click', () => send({ type: 'tool', id: tool.id }));
			control.append(button);
			row.append(head, element('p', 'desc', tool.description), control);
			tools.append(row);
		}
		content.append(tools);
		addNav(nav, 'tools', texts.toolsTitle);
		// The section the extension asked for (a button that points at one setting), else the one shown last.
		if (message.section && navButtons.has(message.section)) {
			current = message.section;
			vscode.setState({ section: current });
		}
		if (!navButtons.has(current)) {
			current = message.rows.length > 0 ? message.rows[0].group : 'tools';
		}

		nothing = element('p');
		nothing.id = 'none';
		nothing.textContent = texts.noMatches;
		nothing.hidden = true;
		page.append(nothing);
		applyFilter();
	}

	function update(newRows) {
		for (const rowData of newRows) {
			const item = rows.get(rowData.id);
			if (item) {
				refresh(item, rowData);
			}
		}
		applyFilter();
	}

	function showResult(message) {
		const item = rows.get(message.id);
		if (!item) {
			return;
		}
		item.error.hidden = !message.error;
		item.error.textContent = message.error || '';
		item.saved.hidden = !!message.error;
		if (!message.error) {
			// "Saved" is only a quiet confirmation; it goes away by itself.
			setTimeout(() => {
				item.saved.hidden = true;
			}, 1500);
		}
	}

	window.addEventListener('message', (event) => {
		const message = event.data;
		if (!message || typeof message !== 'object') {
			return;
		}
		if (message.type === 'init') {
			init(message);
		} else if (message.type === 'show' && texts && navButtons.has(message.section)) {
			choose(message.section);
		} else if (message.type === 'update' && texts) {
			update(message.rows);
		} else if (message.type === 'result' && texts) {
			showResult(message);
		}
	});

	send({ type: 'ready' });
})();
