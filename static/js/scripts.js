document.addEventListener('DOMContentLoaded', () => {
    // Request Notification Permission
    if ('Notification' in window) {
        Notification.requestPermission();
    }

    // Theme Toggle
    const themeToggle = document.querySelector('#theme-toggle');
    const html = document.documentElement;
    themeToggle.addEventListener('click', () => {
        const currentTheme = html.dataset.theme;
        html.dataset.theme = currentTheme === 'light' ? 'dark' : 'light';
        themeToggle.querySelector('i').className = currentTheme === 'light' ? 'fas fa-sun' : 'fas fa-moon';
        localStorage.setItem('theme', html.dataset.theme);
    });
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme) {
        html.dataset.theme = savedTheme;
        themeToggle.querySelector('i').className = savedTheme === 'light' ? 'fas fa-moon' : 'fas fa-sun';
    }

    // Timer Management
    const timers = new Map();
    function formatTime(seconds) {
        const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
        const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
        const s = (seconds % 60).toString().padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    function updateTimer(taskId, seconds) {
        const timerEl = document.querySelector(`.task-card[data-task-id="${taskId}"] .timer`);
        if (timerEl) {
            timerEl.textContent = formatTime(seconds);
            timerEl.dataset.time = seconds;
        }
    }

    async function saveTime(taskId, seconds) {
        try {
            await fetch(`/api/update_time/${taskId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ time_spent: seconds })
            });
        } catch (e) {
            console.error(`Failed to save time for task ${taskId}:`, e);
        }
    }

    // Notes Management
    let currentTaskId = null;
    const notesModal = document.querySelector('#notesModal');
    const notesInput = document.querySelector('#notesInput');
    const saveNotesBtn = document.querySelector('#saveNotesBtn');

    // Progress Management
    async function saveProgress(taskId, progress) {
        try {
            const response = await fetch(`/api/update_progress/${taskId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ progress })
            });
            if (response.ok) {
                const taskCard = document.querySelector(`.task-card[data-task-id="${taskId}"]`);
                taskCard.querySelector('.progress-bar').style.width = `${progress}%`;
                taskCard.querySelector('.progress-bar').setAttribute('aria-valuenow', progress);
                const statusEl = taskCard.querySelector('p:nth-child(7)');
                statusEl.textContent = `Status: ${progress === 100 ? 'Completed' : 'In Progress'}`;
                const completeBtn = taskCard.querySelector('.mark-complete');
                completeBtn.disabled = progress === 100;
                allTasks.find(t => t.id === taskId).progress = progress;
                allTasks.find(t => t.id === taskId).status = progress === 100 ? 'Completed' : 'In Progress';
            }
        } catch (e) {
            console.error(`Failed to save progress for task ${taskId}:`, e);
        }
    }

    document.addEventListener('click', async (e) => {
        if (e.target.classList.contains('notes-btn')) {
            currentTaskId = parseInt(e.target.dataset.taskId);
            const task = allTasks.find(t => t.id === currentTaskId);
            notesInput.value = task.notes || '';
        } else if (e.target === saveNotesBtn) {
            const notes = notesInput.value;
            try {
                const response = await fetch(`/api/update_notes/${currentTaskId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ notes })
                });
                if (response.ok) {
                    const preview = document.querySelector(`.task-card[data-task-id="${currentTaskId}"] .notes-preview`);
                    preview.textContent = notes ? notes.substring(0, 20) + (notes.length > 20 ? '...' : '') : 'None';
                    allTasks.find(t => t.id === currentTaskId).notes = notes;
                    bootstrap.Modal.getInstance(notesModal).hide();
                }
            } catch (e) {
                console.error(`Failed to save notes for task ${currentTaskId}:`, e);
            }
        } else if (e.target.classList.contains('timer-btn')) {
            const taskId = parseInt(e.target.dataset.taskId);
            const action = e.target.dataset.action;
            const timerEl = e.target.closest('.task-card').querySelector('.timer');
            let timerState = timers.get(taskId) || { seconds: parseInt(timerEl.dataset.time), intervalId: null };

            if (action === 'start') {
                if (!timerState.intervalId) {
                    timerState.intervalId = setInterval(() => {
                        timerState.seconds++;
                        updateTimer(taskId, timerState.seconds);
                        timers.set(taskId, timerState);
                    }, 1000);
                    e.target.textContent = 'Pause';
                    e.target.dataset.action = 'pause';
                }
            } else if (action === 'pause') {
                clearInterval(timerState.intervalId);
                timerState.intervalId = null;
                e.target.textContent = 'Start';
                e.target.dataset.action = 'start';
                saveTime(taskId, timerState.seconds);
            } else if (action === 'reset') {
                clearInterval(timerState.intervalId);
                timerState.intervalId = null;
                timerState.seconds = 0;
                updateTimer(taskId, 0);
                saveTime(taskId, 0);
                timers.set(taskId, timerState);
                const startBtn = e.target.closest('.task-card').querySelector('.timer-btn[data-action]');
                startBtn.textContent = 'Start';
                startBtn.dataset.action = 'start';
            }
        }
    });

    // Progress Slider Event
    document.addEventListener('input', async (e) => {
        if (e.target.classList.contains('progress-slider')) {
            const taskId = parseInt(e.target.dataset.taskId);
            const progress = parseInt(e.target.value);
            saveProgress(taskId, progress);
        }
    });

    // Dynamic Task Filtering and Search
    const filterForm = document.querySelector('#filter-form');
    const searchInput = document.querySelector('#search');
    const searchFeedback = document.createElement('small');
    searchFeedback.className = 'form-text text-muted';
    searchInput.parentElement.appendChild(searchFeedback);
    let allTasks = [];

    async function fetchTasks(category, status, sort, search = '') {
        try {
            const response = await fetch(`/api/tasks?category=${category}&status=${status}&sort=${sort}`);
            allTasks = await response.json();
            const taskList = document.querySelector('#task-list');
            taskList.innerHTML = '';
            const filteredTasks = allTasks.filter(task => 
                task.title.toLowerCase().includes(search.toLowerCase()) || 
                (task.tags && task.tags.toLowerCase().includes(search.toLowerCase())) ||
                (task.notes && task.notes.toLowerCase().includes(search.toLowerCase()))
            );
            searchFeedback.textContent = `Found ${filteredTasks.length} task(s)`;
            filteredTasks.forEach(task => {
                const taskCard = document.createElement('div');
                taskCard.className = `task-card ${task.is_overdue ? 'task-overdue' : ''} task-${task.priority.toLowerCase()}-priority`;
                taskCard.draggable = true;
                taskCard.dataset.taskId = task.id;
                taskCard.innerHTML = `
                    <h5>${task.title} <i class="fas fa-tasks"></i></h5>
                    <p>${task.description || 'No description'}</p>
                    <div class="progress mb-2">
                        <div class="progress-bar" role="progressbar" style="width: ${task.progress}%;" aria-valuenow="${task.progress}" aria-valuemin="0" aria-valuemax="100"></div>
                    </div>
                    <input type="range" class="form-range progress-slider" min="0" max="100" value="${task.progress}" data-task-id="${task.id}">
                    <p><strong>Time Spent:</strong> <span class="timer" data-time="${task.time_spent}">${formatTime(task.time_spent)}</span></p>
                    <p><strong>Category:</strong> ${task.category}</p>
                    <p><strong>Due Date:</strong> ${task.due_date}</p>
                    <p><strong>Status:</strong> ${task.status}</p>
                    <p><strong>Priority:</strong> ${task.priority}</p>
                    <p><strong>Tags:</strong> ${task.tags ? task.tags.split(',').map(tag => `<span class="tag">${tag.trim()}</span>`).join('') : 'None'}</p>
                    <p><strong>Notes:</strong> <span class="notes-preview">${task.notes ? task.notes.substring(0, 20) + (task.notes.length > 20 ? '...' : '') : 'None'}</span></p>
                    <button class="btn btn-sm btn-primary btn-3d notes-btn" data-task-id="${task.id}" data-bs-toggle="modal" data-bs-target="#notesModal">Add Notes</button>
                    <button class="btn btn-sm btn-info btn-3d timer-btn" data-task-id="${task.id}" data-action="start">Start Timer</button>
                    <button class="btn btn-sm btn-secondary btn-3d timer-btn" data-task-id="${task.id}" data-action="reset">Reset Timer</button>
                    <a href="/edit_task/${task.id}" class="btn btn-sm btn-warning btn-3d">Edit</a>
                    <form action="/delete_task/${task.id}" method="POST" style="display:inline;">
                        <button type="submit" class="btn btn-sm btn-danger btn-3d" onclick="return confirm('Are you sure?')">Delete</button>
                    </form>
                    <button class="btn btn-sm btn-success btn-3d mark-complete" data-task-id="${task.id}" ${task.status === 'Completed' ? 'disabled' : ''}>Mark as Completed</button>
                `;
                taskList.appendChild(taskCard);
                if (task.is_overdue && Notification.permission === 'granted') {
                    new Notification('Overdue Task', {
                        body: `Task "${task.title}" is overdue! Due: ${task.due_date}`,
                        icon: '/static/favicon.ico'
                    });
                }
            });
            initDragAndDrop();
        } catch (e) {
            console.error('Failed to fetch tasks:', e);
            searchFeedback.textContent = 'Error fetching tasks';
        }
    }

    if (filterForm) {
        filterForm.addEventListener('change', async (e) => {
            e.preventDefault();
            const category = document.querySelector('#category').value;
            const status = document.querySelector('#status').value;
            const sort = document.querySelector('#sort').value;
            const search = searchInput ? searchInput.value : '';
            await fetchTasks(category, status, sort, search);
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', async () => {
            const category = document.querySelector('#category').value;
            const status = document.querySelector('#status').value;
            const sort = document.querySelector('#sort').value;
            await fetchTasks(category, status, sort, searchInput.value);
        });
    }

    // Form Validation
    const taskForm = document.querySelector('#task-form');
    if (taskForm) {
        const titleInput = taskForm.querySelector('#title');
        const dueDateInput = taskForm.querySelector('#due_date');
        titleInput.addEventListener('input', () => {
            if (titleInput.value.length < 1 || titleInput.value.length > 100) {
                titleInput.classList.add('is-invalid');
                titleInput.nextElementSibling.textContent = 'Title must be between 1 and 100 characters.';
            } else {
                titleInput.classList.remove('is-invalid');
                titleInput.classList.add('is-valid');
            }
        });
        dueDateInput.addEventListener('change', () => {
            const today = new Date().toISOString().split('T')[0];
            if (dueDateInput.value < today) {
                dueDateInput.classList.add('is-invalid');
                dueDateInput.nextElementSibling.textContent = 'Due date cannot be in the past.';
            } else {
                dueDateInput.classList.remove('is-invalid');
                dueDateInput.classList.add('is-valid');
            }
        });
    }

    // Mark as Completed with Animation
    document.addEventListener('click', async (e) => {
        if (e.target.classList.contains('mark-complete')) {
            const taskId = e.target.dataset.taskId;
            const taskCard = e.target.closest('.task-card');
            try {
                const response = await fetch(`/api/mark_complete/${taskId}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                if (response.ok) {
                    e.target.disabled = true;
                    taskCard.querySelector('p:nth-child(7)').textContent = 'Status: Completed';
                    taskCard.querySelector('.progress-bar').style.width = '100%';
                    taskCard.querySelector('.progress-bar').setAttribute('aria-valuenow', '100');
                    taskCard.querySelector('.progress-slider').value = 100;
                    taskCard.classList.add('task-completed');
                    const timerState = timers.get(parseInt(taskId));
                    if (timerState && timerState.intervalId) {
                        clearInterval(timerState.intervalId);
                        timerState.intervalId = null;
                        taskCard.querySelector('.timer-btn[data-action="pause"]').textContent = 'Start';
                        taskCard.querySelector('.timer-btn[data-action="pause"]').dataset.action = 'start';
                        saveTime(taskId, timerState.seconds);
                    }
                    setTimeout(() => {
                        taskCard.classList.add('task-hidden');
                        setTimeout(() => {
                            fetchTasks(
                                document.querySelector('#category').value,
                                document.querySelector('#status').value,
                                document.querySelector('#sort').value,
                                searchInput ? searchInput.value : ''
                            );
                        }, 500);
                    }, 1000);
                }
            } catch (e) {
                console.error(`Failed to mark task ${taskId} as complete:`, e);
            }
        }
    });

    // Drag and Drop
    function initDragAndDrop() {
        const taskList = document.querySelector('#task-list');
        const taskCards = document.querySelectorAll('.task-card');
        taskCards.forEach(card => {
            card.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', e.target.dataset.taskId);
                e.target.classList.add('dragging');
            });
            card.addEventListener('dragend', (e) => {
                e.target.classList.remove('dragging');
            });
            card.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.target.closest('.task-card').classList.add('drag-over');
            });
            card.addEventListener('dragleave', (e) => {
                e.target.closest('.task-card').classList.remove('drag-over');
            });
            card.addEventListener('drop', async (e) => {
                e.preventDefault();
                e.target.closest('.task-card').classList.remove('drag-over');
                const draggedId = e.dataTransfer.getData('text/plain');
                const draggedCard = document.querySelector(`[data-task-id="${draggedId}"]`);
                const targetCard = e.target.closest('.task-card');
                if (draggedCard && targetCard && draggedCard !== targetCard) {
                    const allCards = Array.from(taskList.querySelectorAll('.task-card'));
                    const draggedIndex = allCards.indexOf(draggedCard);
                    const targetIndex = allCards.indexOf(targetCard);
                    if (draggedIndex < targetIndex) {
                        taskList.insertBefore(draggedCard, targetCard.nextSibling);
                    } else {
                        taskList.insertBefore(draggedCard, targetCard);
                    }
                    const updatedOrder = Array.from(taskList.querySelectorAll('.task-card')).map((card, index) => ({
                        id: parseInt(card.dataset.taskId),
                        order: index + 1
                    }));
                    try {
                        await fetch('/api/reorder_tasks', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ task_orders: updatedOrder })
                        });
                    } catch (e) {
                        console.error('Failed to reorder tasks:', e);
                    }
                }
            });
        });
    }
});