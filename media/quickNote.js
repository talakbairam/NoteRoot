// Quick Note webview script. No external libraries, no inline handlers (see the CSP in QuickNoteViewProvider).
// Message contract: src/webview/messages.ts. All user-facing text arrives from the extension.
(function () {
	'use strict';

	const vscode = acquireVsCodeApi();
	const textarea = document.getElementById('note-text');
	const saveButton = document.getElementById('save');
	const saveOpenButton = document.getElementById('save-open');
	const pasteButton = document.getElementById('paste');
	const status = document.getElementById('status');
	const rootAction = document.getElementById('root-action');
	const selectRootButton = document.getElementById('select-root');
	const rootProblem = document.getElementById('root-problem');
	const rootProblemText = document.getElementById('root-problem-text');
	const noteBox = document.querySelector('.note');
	const advancedSection = document.getElementById('advanced');

	const DRAFT_DEBOUNCE_MS = 300;
	/** At most this many tags come from the patterns (the same limit as in the extension). */
	const MAX_PATTERN_TAGS = Number(document.getElementById('tag-chips').dataset.maxPatternTags) || 20;

	let saving = false;
	let draftTimer;

	// What the page remembers while the view exists. Values are always merged, so saving one never erases another.
	let pageState = vscode.getState() || {};
	function saveState(patch) {
		pageState = Object.assign({}, pageState, patch);
		vscode.setState(pageState);
	}

	/**
	 * The text box and the panel of the chosen tags have a fixed height. The user changes it by dragging the corner, and the
	 * height is remembered (under `key`) while the view exists.
	 */
	function keepResizable(element, key, minPx) {
		if (typeof pageState[key] === 'number' && pageState[key] >= minPx) {
			element.style.height = pageState[key] + 'px';
		}
		// 0 until the element has been measured while it is shown; the first measure is the starting height, not a change.
		let last = 0;
		function remember() {
			const height = Math.round(element.offsetHeight);
			// A hidden element measures 0; a change of the width alone is not a new height.
			if (height < minPx || height === last) {
				return;
			}
			const first = last === 0;
			last = height;
			if (!first) {
				saveState({ [key]: height });
			}
		}
		remember();
		if (typeof ResizeObserver === 'function') {
			new ResizeObserver(remember).observe(element);
		}
		// The end of a drag of the corner, in case the observer is not available.
		element.addEventListener('mouseup', remember);
	}
	keepResizable(textarea, 'height', 60);

	// Local cache so the text shows at once; the extension's `init` message replaces it.
	if (typeof pageState.draft === 'string') {
		textarea.value = pageState.draft;
	}
	// ----- Advanced: Category and Tag, each a text box with a list under it -----
	// A click opens the whole list, typing narrows it down, the arrow keys and Enter pick an entry. When the
	// typed name is not in the list, the last entry creates it (the extension asks for the details).
	const tagChips = document.getElementById('tag-chips');
	keepResizable(tagChips, 'tagsHeight', 28);
	/** The combo boxes by key: `category` and `tag`. */
	const combos = {};
	/** The category the box shows as chosen ('' = none). */
	let chosenCategory = typeof pageState.category === 'string' ? pageState.category : '';
	let reportedCategory = null;
	/** What a category shows instead of its name (a file name), and the text of its tooltip (a path). */
	let categoryLabels = {};
	let categoryTips = {};
	/** Notes that start with these texts get the tag by itself / go to the category. The extension decides at Save; this is a preview. */
	let tagKeywords = {};
	/** Regular expression sources made by the extension: text that matches becomes a tag. Empty while the mode is off. */
	let tagPatterns = [];
	let categoryKeywords = {};
	const labelOf = (name) => categoryLabels[name] || name;
	const tipOf = (name) => categoryTips[name] || labelOf(name);

	/** Shows the chosen category in its box: the label as text, the path as tooltip, so a cut-off name can be read. */
	function showCategory() {
		combos.category.setText(chosenCategory === '' ? '' : labelOf(chosenCategory), chosenCategory === '' ? '' : tipOf(chosenCategory));
	}

	// The extension needs the chosen category: the notes go to the file linked to it.
	function reportCategory() {
		if (reportedCategory === chosenCategory) {
			return;
		}
		reportedCategory = chosenCategory;
		vscode.postMessage({ type: 'choiceChanged', kind: 'category', value: chosenCategory });
	}

	function setCategory(name) {
		chosenCategory = name;
		showCategory();
		showAutoCategory();
		saveState({ category: name });
		reportCategory();
	}

	// ----- Tags: any number can be chosen. The list adds one, a chip shows it, the chip's button removes it. -----
	// An older version of this page stored a single `tag`.
	let chosenTags = Array.isArray(pageState.tags)
		? pageState.tags.filter((name) => typeof name === 'string')
		: typeof pageState.tag === 'string' && pageState.tag !== '' ? [pageState.tag] : [];
	let reportedTags = null;

	function reportTags() {
		const key = JSON.stringify(chosenTags);
		if (reportedTags === key) {
			return;
		}
		reportedTags = key;
		vscode.postMessage({ type: 'tagsChanged', tags: chosenTags });
	}

	/** Where the keyword first appears in the note (any case), or -1. The same rule as the extension uses at Save. */
	function keywordPosition(text, keyword) {
		const wanted = String(keyword).trim().toLowerCase();
		return wanted === '' ? -1 : text.toLowerCase().indexOf(wanted);
	}

	function containsKeyword(text, keyword) {
		return keywordPosition(text, keyword) >= 0;
	}

	/** The text of the note that matches a tag pattern, in the order it appears, each once (any case). */
	function patternTagNames() {
		const found = [];
		const seen = new Set();
		for (const source of tagPatterns) {
			let expression;
			try {
				expression = new RegExp(source, 'giu');
			} catch {
				continue;
			}
			const whole = new RegExp('^' + source + '$', 'iu');
			for (const match of textarea.value.matchAll(expression)) {
				// A - or _ right at the end belongs to the sentence, not to the tag (the same rule as in the extension).
				const name = match[0].replace(/[-_]+$/, '');
				const key = name.toLowerCase();
				if (name !== '' && whole.test(name) && !seen.has(key)) {
					seen.add(key);
					found.push({ name, at: match.index });
				}
			}
		}
		return found.sort((a, b) => a.at - b.at).slice(0, MAX_PATTERN_TAGS).map((entry) => entry.name);
	}

	/** The tags the note will get by itself (keywords, then patterns), that are not chosen already. */
	function autoTagNames() {
		const taken = new Set(chosenTags.map((name) => name.toLowerCase()));
		const names = [];
		const candidates = [
			...Object.keys(tagKeywords).filter((name) => containsKeyword(textarea.value, tagKeywords[name])),
			...(tagPatterns.length > 0 ? patternTagNames() : []),
		];
		for (const name of candidates) {
			if (!taken.has(name.toLowerCase())) {
				taken.add(name.toLowerCase());
				names.push(name);
			}
		}
		return names;
	}

	/** The category the note will go to by its keyword, when none is chosen: the keyword that appears first in the text. */
	function autoCategoryName() {
		if (chosenCategory !== '') {
			return '';
		}
		const text = textarea.value;
		const found = Object.keys(categoryKeywords)
			.map((name) => ({ name, at: keywordPosition(text, categoryKeywords[name]) }))
			.filter((entry) => entry.at >= 0)
			.sort((a, b) => a.at - b.at || categoryKeywords[b.name].length - categoryKeywords[a.name].length);
		return found.length > 0 ? found[0].name : '';
	}

	function renderTags() {
		tagChips.textContent = '';
		for (const name of chosenTags) {
			const chip = document.createElement('span');
			chip.className = 'chip';
			chip.setAttribute('role', 'listitem');
			const label = document.createElement('span');
			label.className = 'chip-name';
			label.textContent = '#' + name;
			const remove = document.createElement('button');
			remove.type = 'button';
			remove.className = 'chip-remove';
			remove.textContent = '×';
			const removeLabel = tagChips.dataset.removeTemplate.replace('{tag}', name);
			remove.title = removeLabel;
			remove.setAttribute('aria-label', removeLabel);
			remove.addEventListener('click', () => setChosenTags(chosenTags.filter((entry) => entry !== name)));
			chip.append(label, remove);
			tagChips.appendChild(chip);
		}
		// The tags the note will get by its keyword: shown, but only the extension adds them, so they cannot be removed.
		const autoNames = autoTagNames();
		for (const name of autoNames) {
			const chip = document.createElement('span');
			chip.className = 'chip auto';
			chip.setAttribute('role', 'listitem');
			chip.title = tagChips.dataset.autoTitle;
			const label = document.createElement('span');
			label.className = 'chip-name';
			label.textContent = '#' + name;
			chip.appendChild(label);
			tagChips.appendChild(chip);
		}
		// Only tags that are not chosen yet are offered.
		combos.tag.refresh();
		showAutoCategory();
	}

	/** The Category box says which category the note will go to by its keyword, while none is chosen. */
	function showAutoCategory() {
		const input = combos.category.input;
		const auto = autoCategoryName();
		input.placeholder = auto === '' ? input.dataset.defaultPlaceholder : document.getElementById('category-combo').dataset.autoTemplate.replace('{name}', labelOf(auto));
	}

	function setChosenTags(tags) {
		chosenTags = tags.filter((name, index) => tags.indexOf(name) === index);
		saveState({ tags: chosenTags });
		renderTags();
		reportTags();
	}

	/**
	 * A text box with a list. `hidden(name)` leaves names out of the list. The handlers decide what picking a
	 * name, creating one (`name` is what was typed, or undefined for the plain "Create…" entry) and leaving the
	 * box with some text in it mean.
	 */
	function createCombo(element, handlers) {
		// `handlers.label(name)` is what a name shows, `handlers.tip(name)` its tooltip.
		const input = element.querySelector('input');
		const list = element.querySelector('ul');
		const toggle = element.querySelector('.combo-toggle');
		const clear = element.querySelector('.combo-clear');
		const state = { names: [], open: false, typed: false, active: -1, entries: [] };

		/** The names to show: all of them, or the ones that fit what was typed (exact, then start, then contain). */
		function visibleNames() {
			const names = state.names.filter((name) => !handlers.hidden(name));
			const text = state.typed ? input.value.trim().toLowerCase() : '';
			if (text === '') {
				return names;
			}
			// What is shown counts first; the whole name (a path) also counts, so a folder can be typed.
			const rank = (name) => {
				const lower = handlers.label(name).toLowerCase();
				if (lower === text) {
					return 0;
				}
				return lower.startsWith(text) ? 1 : lower.includes(text) ? 2 : name.toLowerCase().includes(text) ? 2 : 3;
			};
			return names.filter((name) => rank(name) < 3).sort((a, b) => rank(a) - rank(b));
		}

		function exactName(text) {
			const lower = text.trim().toLowerCase();
			return lower === ''
				? undefined
				: state.names.find((name) => !handlers.hidden(name) && (handlers.label(name).toLowerCase() === lower || name.toLowerCase() === lower));
		}

		function render() {
			const text = state.typed ? input.value.trim() : '';
			state.entries = visibleNames().map((name) => ({ type: 'name', name }));
			// With some text that is not a name yet, creating it with that text is offered.
			const named = text !== '' && exactName(text) === undefined;
			state.entries.push({
				type: 'create',
				name: named ? text : undefined,
				label: named ? element.dataset.createNamed.replace('{name}', text) : element.dataset.createLabel,
			});
			list.textContent = '';
			state.entries.forEach((entry, index) => {
				const item = document.createElement('li');
				item.id = element.id + '-option-' + index;
				item.setAttribute('role', 'option');
				item.className = entry.type === 'create' ? 'combo-option create' : 'combo-option';
				item.textContent = entry.type === 'create' ? entry.label : handlers.label(entry.name);
				// A long name is cut by the list; the tooltip has all of it.
				item.title = entry.type === 'create' ? '' : handlers.tip(entry.name);
				item.classList.toggle('active', index === state.active);
				item.setAttribute('aria-selected', String(index === state.active));
				if (entry.type === 'name' && handlers.isChosen(entry.name)) {
					item.classList.add('chosen');
				}
				// mousedown, not click: the box must not lose the focus, or the list would close first.
				item.addEventListener('mousedown', (event) => {
					event.preventDefault();
					choose(index);
				});
				list.appendChild(item);
			});
			input.setAttribute('aria-activedescendant', state.active >= 0 ? element.id + '-option-' + state.active : '');
			place();
			// Scrolls only the list, never the page (scrollIntoView could move the whole panel).
			const active = list.children[state.active];
			if (active) {
				const top = active.offsetTop;
				const bottom = top + active.offsetHeight;
				if (top < list.scrollTop) {
					list.scrollTop = top;
				} else if (bottom > list.scrollTop + list.clientHeight) {
					list.scrollTop = bottom - list.clientHeight;
				}
			}
		}

		/**
		 * Keeps the list inside the visible panel: it opens downwards when there is room, upwards when there is more room above,
		 * and is never taller than the room it has, so the page does not have to be scrolled (the list scrolls instead).
		 */
		function place() {
			if (!state.open) {
				return;
			}
			const MARGIN_PX = 6;
			const MAX_LIST_PX = 180;
			const MIN_LIST_PX = 48;
			const box = element.getBoundingClientRect();
			const below = window.innerHeight - box.bottom - MARGIN_PX;
			const above = box.top - MARGIN_PX;
			list.style.maxHeight = MAX_LIST_PX + 'px';
			const wanted = Math.min(list.scrollHeight + 6, MAX_LIST_PX);
			const up = below < wanted && above > below;
			list.classList.toggle('up', up);
			list.style.maxHeight = Math.max(MIN_LIST_PX, Math.min(MAX_LIST_PX, up ? above : below)) + 'px';
		}
		window.addEventListener('resize', place);

		function open() {
			if (state.open) {
				return;
			}
			state.open = true;
			list.hidden = false;
			input.setAttribute('aria-expanded', 'true');
			state.active = handlers.chosenIndex(visibleNames());
			render();
		}

		function close() {
			state.open = false;
			state.typed = false;
			state.active = -1;
			list.hidden = true;
			input.setAttribute('aria-expanded', 'false');
			input.setAttribute('aria-activedescendant', '');
		}

		function choose(index) {
			const entry = state.entries[index];
			if (!entry) {
				return;
			}
			close();
			if (entry.type === 'create') {
				handlers.create(entry.name);
			} else {
				handlers.pick(entry.name);
			}
		}

		input.addEventListener('focus', () => {
			input.select();
			open();
		});
		input.addEventListener('click', open);
		input.addEventListener('input', () => {
			state.typed = true;
			if (!state.open) {
				open();
			}
			// The first entry is what Enter takes: the best match, or "Create…" when nothing fits.
			state.active = 0;
			render();
		});
		input.addEventListener('keydown', (event) => {
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				if (!state.open) {
					open();
					return;
				}
				const last = state.entries.length - 1;
				state.active = event.key === 'ArrowDown' ? Math.min(state.active + 1, last) : Math.max(state.active - 1, 0);
				render();
			} else if (event.key === 'Enter') {
				event.preventDefault();
				const text = input.value.trim();
				if (state.open && state.active >= 0) {
					choose(state.active);
				} else if (text !== '') {
					const exact = exactName(text);
					close();
					if (exact !== undefined) {
						handlers.pick(exact);
					} else {
						handlers.create(text);
					}
				}
			} else if (event.key === 'Escape' && state.open) {
				// Closes the list only, and puts the last choice back.
				event.preventDefault();
				event.stopPropagation();
				close();
				handlers.revert();
			}
		});
		input.addEventListener('blur', () => {
			close();
			handlers.leave(input.value.trim(), exactName(input.value));
		});
		toggle.addEventListener('mousedown', (event) => {
			event.preventDefault();
			if (state.open) {
				close();
			} else {
				input.focus();
				open();
			}
		});
		if (clear) {
			clear.addEventListener('mousedown', (event) => {
				event.preventDefault();
				close();
				handlers.pick('');
			});
		}

		return {
			setNames(names) {
				state.names = names;
				if (state.open) {
					render();
				}
			},
			setText(text, tip) {
				input.value = text;
				input.title = tip || text;
				if (clear) {
					clear.hidden = text === '';
				}
			},
			/** Draws the list again, for example after a tag was chosen. */
			refresh() {
				if (state.open) {
					render();
				}
			},
			input,
		};
	}

	combos.category = createCombo(document.getElementById('category-combo'), {
		label: labelOf,
		tip: tipOf,
		hidden: () => false,
		isChosen: (name) => name === chosenCategory,
		chosenIndex: (names) => names.indexOf(chosenCategory),
		pick: (name) => setCategory(name),
		create: (name) => {
			showCategory();
			vscode.postMessage({ type: 'createOption', kind: 'category', name });
		},
		revert: showCategory,
		// Leaving the box: an emptied box clears the choice, a name that exists is taken, anything else is undone.
		leave: (text, exact) => {
			if (text === '') {
				setCategory('');
			} else if (exact !== undefined) {
				setCategory(exact);
			} else {
				showCategory();
			}
		},
	});
	combos.category.input.dataset.defaultPlaceholder = combos.category.input.placeholder;
	combos.tag = createCombo(document.getElementById('tag-combo'), {
		label: (name) => name,
		tip: (name) => name,
		hidden: (name) => chosenTags.includes(name),
		isChosen: () => false,
		chosenIndex: () => -1,
		pick: (name) => {
			combos.tag.setText('');
			if (name !== '') {
				setChosenTags([...chosenTags, name]);
			}
		},
		create: (name) => {
			combos.tag.setText('');
			vscode.postMessage({ type: 'createOption', kind: 'tag', name });
		},
		revert: () => combos.tag.setText(''),
		leave: () => combos.tag.setText(''),
	});

	/**
	 * Shows new lists. `chosen` ({ kind, value }) is the entry to select, for a name that was just created or renamed.
	 * With `useSaved` the choice remembered by this page is restored, otherwise the current one is kept.
	 */
	function applyLists(lists, chosen, useSaved) {
		const clean = (value) => (Array.isArray(value) ? value.filter((name) => typeof name === 'string') : []);
		const categories = clean(lists.categories);
		const tags = clean(lists.tags);
		const record = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : {});
		categoryLabels = record(lists.categoryLabels);
		categoryTips = record(lists.categoryTips);
		tagKeywords = record(lists.tagKeywords);
		tagPatterns = Array.isArray(lists.tagPatterns) ? lists.tagPatterns.filter((source) => typeof source === 'string') : [];
		categoryKeywords = record(lists.categoryKeywords);
		combos.category.setNames(categories);
		combos.tag.setNames(tags);

		let preferred = useSaved ? pageState.category : chosenCategory;
		if (chosen && chosen.kind === 'category') {
			preferred = chosen.value;
		}
		// A name that no longer exists falls back to "nothing chosen".
		setCategory(categories.includes(preferred) ? preferred : '');

		// Tags that no longer exist are dropped. A tag that was just created or renamed is added.
		const wanted = chosen && chosen.kind === 'tag' ? [...chosenTags, chosen.value] : chosenTags;
		setChosenTags(wanted.filter((name) => tags.includes(name)));
	}

	// Hovering Save tells where the note goes. The template comes from the extension, like every text.
	function setTarget(file) {
		const template = saveButton.dataset.titleTemplate || '{file}';
		saveButton.title = typeof file === 'string' ? template.replace('{file}', file) : '';
		const openTemplate = saveOpenButton.dataset.titleTemplate || '{file}';
		saveOpenButton.title = typeof file === 'string' ? openTemplate.replace('{file}', file) : '';
	}

	// Without a notes folder (or when it is gone) the box is replaced by the reason and a button to select a folder, like the Notes view.
	function setRootProblem(message) {
		const problem = typeof message === 'string' && message !== '' ? message : undefined;
		rootProblem.hidden = problem === undefined;
		rootProblemText.textContent = problem === undefined ? '' : problem;
		noteBox.classList.toggle('no-root', problem !== undefined);
	}

	// The Advanced dropdowns are only there while the mode is on.
	function setAdvanced(enabled) {
		advancedSection.hidden = enabled !== true;
	}

	// `saving` is true while the extension writes a note (typed or pasted). Both buttons wait for it.
	function updateButton() {
		saveButton.disabled = saving || textarea.value.trim().length === 0;
		saveOpenButton.disabled = saveButton.disabled;
		pasteButton.disabled = saving;
	}

	/** The preview of what the keywords do follows the text. It needs the Advanced boxes, which exist from the start. */
	function refreshAuto() {
		if (typeof renderTags === 'function' && combos.tag) {
			renderTags();
		}
	}

	function clearStatus() {
		status.textContent = '';
		status.classList.remove('error');
		rootAction.hidden = true;
	}

	function showError(message, offerSelectRoot) {
		clearStatus();
		status.textContent = message;
		status.classList.add('error');
		rootAction.hidden = !offerSelectRoot;
	}

	function setText(text) {
		textarea.value = text;
		saveState({ draft: text });
		updateButton();
		refreshAuto();
	}

	function setSaving(value) {
		saving = value;
		textarea.readOnly = value; // Typing during a save would be lost when the box is cleared.
		updateButton();
	}

	// A note from the clipboard does not touch the box, so the text stays editable meanwhile.
	function setPasting(value) {
		saving = value;
		updateButton();
	}

	function newId() {
		return typeof crypto !== 'undefined' && crypto.randomUUID
			? crypto.randomUUID()
			: Date.now().toString(36) + Math.random().toString(36).slice(2);
	}

	/** @param open also open the file the note was written to */
	function submit(open) {
		if (saving || textarea.value.trim().length === 0) {
			return;
		}
		clearTimeout(draftTimer);
		clearStatus();
		setSaving(true);
		vscode.postMessage({ type: 'submit', id: newId(), text: textarea.value, open: open === true });
	}

	textarea.addEventListener('input', () => {
		updateButton();
		refreshAuto();
		saveState({ draft: textarea.value });
		if (status.classList.contains('error')) {
			clearStatus();
		}
		clearTimeout(draftTimer);
		draftTimer = setTimeout(() => {
			vscode.postMessage({ type: 'draftChanged', text: textarea.value });
		}, DRAFT_DEBOUNCE_MS);
	});

	saveButton.addEventListener('click', () => submit(false));
	saveOpenButton.addEventListener('click', () => submit(true));
	pasteButton.addEventListener('click', () => {
		if (saving) {
			return;
		}
		clearStatus();
		setPasting(true);
		vscode.postMessage({ type: 'pasteAndSave' });
	});
	selectRootButton.addEventListener('click', () => vscode.postMessage({ type: 'selectRoot' }));
	document.getElementById('select-root-problem').addEventListener('click', () => vscode.postMessage({ type: 'selectRoot' }));

	// A narrower or wider sidebar changes where the lines wrap, so the height must follow.

	window.addEventListener('message', (event) => {
		const message = event.data;
		if (!message || typeof message.type !== 'string') {
			return;
		}
		switch (message.type) {
			case 'init':
			case 'setDraft':
				clearTimeout(draftTimer);
				setText(typeof (message.draft ?? message.text) === 'string' ? (message.draft ?? message.text) : '');
				if (message.type === 'init') {
					setTarget(message.file);
					setAdvanced(message.advanced);
					setRootProblem(message.rootProblem);
					applyLists(message, null, true);
				}
				break;
			case 'target':
				setTarget(message.file);
				break;
			case 'rootProblem':
				setRootProblem(message.message);
				break;
			case 'advanced':
				setAdvanced(message.enabled);
				break;
			case 'options':
				applyLists(message, message.select, false);
				break;
			case 'saved':
				if (message.keepText === true) {
					// Saved from the clipboard: what the user typed stays exactly as it is.
					setPasting(false);
					clearStatus();
					break;
				}
				clearTimeout(draftTimer);
				setSaving(false);
				setText('');
				clearStatus();
				textarea.focus();
				break;
			case 'error':
				setSaving(false);
				showError(String(message.message), message.showSelectRoot === true);
				break;
			case 'focus':
				textarea.focus();
				break;
		}
	});

	updateButton();
	vscode.postMessage({ type: 'ready' });
})();
