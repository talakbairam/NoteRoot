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
				input.type = 'text';
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

		row.append(head, description, control, meta, item.error);
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
		for (const section of page.querySelectorAll('section')) {
			section.hidden = section.querySelectorAll('.row:not([hidden])').length === 0;
		}
		nothing.hidden = shown !== 0;
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

		const sections = new Map();
		for (const rowData of message.rows) {
			let section = sections.get(rowData.group);
			if (!section) {
				section = element('section');
				section.append(element('h2', undefined, rowData.groupLabel));
				sections.set(rowData.group, section);
				page.append(section);
			}
			const item = build(rowData);
			rows.set(rowData.id, item);
			section.append(item.row);
			refresh(item, rowData);
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
		} else if (message.type === 'update' && texts) {
			update(message.rows);
		} else if (message.type === 'result' && texts) {
			showResult(message);
		}
	});

	send({ type: 'ready' });
})();
