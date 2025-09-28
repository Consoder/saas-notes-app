

const CONFIG = {
    APP_NAME: 'NotesAI',
    VERSION: '1.0.0',
    JWT_SECRET: 'multittenant_notes_ai_secret_2025',
    TOKEN_EXPIRY: 24 * 60 * 60 * 1000, // 24 hours
    FREE_PLAN_LIMIT: 3,
    PRO_PLAN_LIMIT: -1 // Unlimited
};

// ==================== TEST ACCOUNTS ====================
const TEST_ACCOUNTS = [
    {
        email: 'admin@acme.test',
        password: 'password',
        role: 'Admin',
        tenant: 'acme',
        name: 'Sarah Johnson',
        avatar: 'SJ',
        id: 'user_admin_acme'
    },
    {
        email: 'user@acme.test',
        password: 'password',
        role: 'Member',
        tenant: 'acme',
        name: 'Mike Chen',
        avatar: 'MC',
        id: 'user_member_acme'
    },
    {
        email: 'admin@globex.test',
        password: 'password',
        role: 'Admin',
        tenant: 'globex',
        name: 'Emma Davis',
        avatar: 'ED',
        id: 'user_admin_globex'
    },
    {
        email: 'user@globex.test',
        password: 'password',
        role: 'Member',
        tenant: 'globex',
        name: 'Alex Kumar',
        avatar: 'AK',
        id: 'user_member_globex'
    }
];

// ==================== TENANT DATA ====================
const TENANTS = {
    acme: {
        slug: 'acme',
        name: 'Acme Corporation',
        plan: 'free',
        noteLimit: CONFIG.FREE_PLAN_LIMIT
    },
    globex: {
        slug: 'globex',
        name: 'Globex Corporation',
        plan: 'free',
        noteLimit: CONFIG.FREE_PLAN_LIMIT
    }
};

// ==================== SAMPLE NOTES ====================
let NOTES_DATABASE = [
    {
        id: 'acme_note_001',
        title: 'Product Strategy 2025',
        content: 'Key initiatives for next year: AI integration, user experience improvements, and market expansion.\n\n**Timeline**: October - December 2025\n**Owner**: Product Team\n\n### Success Metrics\n- User engagement +25%\n- Search accuracy >95%\n- System uptime 99.9%',
        tenant: 'acme',
        userId: 'user_admin_acme',
        createdAt: '2025-09-25T10:00:00Z',
        updatedAt: '2025-09-27T14:30:00Z'
    },
    {
        id: 'acme_note_002',
        title: 'Engineering Best Practices',
        content: '# Development Standards\n\n## Code Review Process\n1. All PRs require 2 approvals\n2. Automated testing must pass\n3. Security scan completion\n4. Performance benchmarks\n\n## Performance Goals\n- API response time < 200ms\n- 99.9% uptime SLA\n- Zero security vulnerabilities',
        tenant: 'acme',
        userId: 'user_member_acme',
        createdAt: '2025-09-20T09:00:00Z',
        updatedAt: '2025-09-26T16:45:00Z'
    },
    {
        id: 'globex_note_001',
        title: 'Manufacturing Process Optimization',
        content: '## Current Challenges\n\n- Production line efficiency at 78%\n- Quality control inconsistencies\n- Supply chain delays averaging 3.2 days\n\n## Proposed Solutions\n1. **IoT Integration** - Real-time sensor monitoring\n2. **AI-Powered Analytics** - Pattern recognition for defect prediction\n3. **Supply Chain Enhancement** - Multiple supplier partnerships\n\n**Expected ROI**: 35% efficiency gain within 6 months',
        tenant: 'globex',
        userId: 'user_admin_globex',
        createdAt: '2025-09-18T11:30:00Z',
        updatedAt: '2025-09-28T08:15:00Z'
    }
];

// ==================== APPLICATION STATE ====================
let currentUser = null;
let currentTenant = null;
let currentToken = null;
let notes = [];
let editingNoteId = null;

// ==================== AUTHENTICATION FUNCTIONS ====================
function generateJWT(user, tenant) {
    const payload = {
        userId: user.id,
        email: user.email,
        role: user.role,
        tenant: tenant.slug,
        name: user.name,
        avatar: user.avatar,
        iat: Date.now(),
        exp: Date.now() + CONFIG.TOKEN_EXPIRY
    };
    return btoa(JSON.stringify(payload)) + '.' + btoa(CONFIG.JWT_SECRET);
}

function validateJWT(token) {
    try {
        if (!token) return null;
        const parts = token.split('.');
        if (parts.length !== 2) return null;
        const payload = JSON.parse(atob(parts[0]));
        const secret = atob(parts[1]);
        if (secret !== CONFIG.JWT_SECRET) return null;
        if (Date.now() > payload.exp) return null;
        return payload;
    } catch (error) {
        return null;
    }
}

function authenticateUser(email, password) {
    const account = TEST_ACCOUNTS.find(acc => acc.email === email);
    if (!account || account.password !== password) {
        return { success: false, error: 'Invalid credentials' };
    }
    
    const tenant = TENANTS[account.tenant];
    if (!tenant) {
        return { success: false, error: 'Tenant not found' };
    }
    
    const token = generateJWT(account, tenant);
    return {
        success: true,
        user: account,
        tenant: tenant,
        token: token
    };
}

function requireAuth() {
    if (!currentToken || !currentUser || !currentTenant) {
        throw new Error('Authentication required');
    }
    const payload = validateJWT(currentToken);
    if (!payload) {
        throw new Error('Invalid or expired token');
    }
    return payload;
}

// ==================== TENANT ISOLATION ====================
function validateTenantAccess(resourceTenant) {
    const payload = requireAuth();
    if (resourceTenant !== payload.tenant) {
        throw new Error('Access denied: Tenant isolation violation');
    }
    return true;
}

function filterNotesByTenant(notes, tenantSlug) {
    return notes.filter(note => note.tenant === tenantSlug);
}

// ==================== SUBSCRIPTION LIMITS ====================
function checkNoteLimit(tenantSlug) {
    const tenant = TENANTS[tenantSlug];
    if (!tenant) {
        throw new Error('Tenant not found');
    }
    
    if (tenant.plan === 'pro' || tenant.noteLimit === -1) {
        return { canCreate: true, remaining: -1 };
    }
    
    const currentNotes = filterNotesByTenant(NOTES_DATABASE, tenantSlug);
    const remaining = tenant.noteLimit - currentNotes.length;
    
    return {
        canCreate: remaining > 0,
        remaining: remaining,
        limit: tenant.noteLimit,
        current: currentNotes.length
    };
}

function upgradeTenant(tenantSlug) {
    if (!currentUser || currentUser.role !== 'Admin') {
        throw new Error('Only administrators can upgrade subscriptions');
    }
    
    const tenant = TENANTS[tenantSlug];
    if (!tenant) throw new Error('Tenant not found');
    if (tenant.plan === 'pro') throw new Error('Tenant already on Pro plan');
    
    tenant.plan = 'pro';
    tenant.noteLimit = CONFIG.PRO_PLAN_LIMIT;
    
    if (currentTenant && currentTenant.slug === tenantSlug) {
        currentTenant.plan = 'pro';
        currentTenant.noteLimit = CONFIG.PRO_PLAN_LIMIT;
    }
    
    return { success: true, plan: 'pro' };
}

// ==================== NOTES CRUD OPERATIONS ====================
function createNote(title, content) {
    const payload = requireAuth();
    const limitCheck = checkNoteLimit(payload.tenant);
    if (!limitCheck.canCreate) {
        throw new Error('Note limit reached. Upgrade to Pro for unlimited notes.');
    }
    
    if (!title?.trim() || !content?.trim()) {
        throw new Error('Title and content are required');
    }
    
    const noteId = `${payload.tenant}_note_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    const now = new Date().toISOString();
    
    const newNote = {
        id: noteId,
        title: title.trim(),
        content: content.trim(),
        tenant: payload.tenant,
        userId: payload.userId,
        createdAt: now,
        updatedAt: now
    };
    
    NOTES_DATABASE.push(newNote);
    return newNote;
}

function getNotes() {
    const payload = requireAuth();
    return filterNotesByTenant(NOTES_DATABASE, payload.tenant);
}

function getNote(noteId) {
    const payload = requireAuth();
    const note = NOTES_DATABASE.find(n => n.id === noteId);
    if (!note) throw new Error('Note not found');
    validateTenantAccess(note.tenant);
    return note;
}

function updateNote(noteId, title, content) {
    const payload = requireAuth();
    if (!title?.trim() || !content?.trim()) {
        throw new Error('Title and content are required');
    }
    
    const noteIndex = NOTES_DATABASE.findIndex(n => n.id === noteId);
    if (noteIndex === -1) throw new Error('Note not found');
    
    const note = NOTES_DATABASE[noteIndex];
    validateTenantAccess(note.tenant);
    
    NOTES_DATABASE[noteIndex] = {
        ...note,
        title: title.trim(),
        content: content.trim(),
        updatedAt: new Date().toISOString()
    };
    
    return NOTES_DATABASE[noteIndex];
}

function deleteNote(noteId) {
    const payload = requireAuth();
    const noteIndex = NOTES_DATABASE.findIndex(n => n.id === noteId);
    if (noteIndex === -1) throw new Error('Note not found');
    
    const note = NOTES_DATABASE[noteIndex];
    validateTenantAccess(note.tenant);
    NOTES_DATABASE.splice(noteIndex, 1);
    
    return { success: true, id: noteId };
}

// ==================== EVENT HANDLERS ====================
function handleLogin(e) {
    e.preventDefault();
    
    const email = document.getElementById('email')?.value?.trim();
    const password = document.getElementById('password')?.value;
    
    if (!email || !password) {
        showError('Please enter both email and password');
        return;
    }
    
    performLogin(email, password);
}

function handleQuickLogin(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const email = e.currentTarget?.dataset?.email;
    if (!email) {
        showError('Invalid login attempt');
        return;
    }
    
    performLogin(email, 'password');
}

function performLogin(email, password) {
    const submitBtn = document.getElementById('login-submit-btn');
    const btnText = submitBtn?.querySelector('.btn-text');
    const btnLoading = submitBtn?.querySelector('.btn-loading');
    
    try {
        // Show loading state
        if (submitBtn) submitBtn.disabled = true;
        if (btnText) btnText.style.opacity = '0.7';
        if (btnLoading) btnLoading.classList.remove('hidden');
        
        const result = authenticateUser(email, password);
        
        if (result.success) {
            currentUser = result.user;
            currentTenant = result.tenant;
            currentToken = result.token;
            
            notes = getNotes();
            showDashboard();
            showSuccess(`Welcome back, ${result.user.name}! 🎉`);
            clearError();
        } else {
            showError(result.error || 'Login failed');
        }
    } catch (error) {
        console.error('Login error:', error);
        showError('Login failed. Please try again.');
    } finally {
        // Reset button state
        if (submitBtn) submitBtn.disabled = false;
        if (btnText) btnText.style.opacity = '1';
        if (btnLoading) btnLoading.classList.add('hidden');
    }
}

function handleLogout() {
    currentUser = null;
    currentTenant = null;
    currentToken = null;
    notes = [];
    editingNoteId = null;
    
    // Clear form
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    if (emailInput) emailInput.value = '';
    if (passwordInput) passwordInput.value = '';
    
    showLoginPage();
    showSuccess('Signed out successfully');
}

// ==================== NOTES UI HANDLERS ====================
function openCreateNoteModal() {
    if (!currentTenant) {
        showError('Please log in first');
        return;
    }
    
    const limitCheck = checkNoteLimit(currentTenant.slug);
    if (!limitCheck.canCreate) {
        showError('Note limit reached! Upgrade to Pro for unlimited notes. 💎');
        return;
    }
    
    editingNoteId = null;
    const modalTitle = document.getElementById('modal-title');
    const saveBtn = document.getElementById('save-note-btn');
    const titleInput = document.getElementById('note-title');
    const contentInput = document.getElementById('note-content');
    
    if (modalTitle) modalTitle.textContent = 'Create Note';
    if (saveBtn) {
        const btnText = saveBtn.querySelector('.btn-text');
        if (btnText) btnText.textContent = 'Create Note';
    }
    if (titleInput) titleInput.value = '';
    if (contentInput) contentInput.value = '';
    
    showModal();
}

function editNote(noteId) {
    const note = notes.find(n => n.id === noteId);
    if (!note) {
        showError('Note not found');
        return;
    }
    
    editingNoteId = noteId;
    const modalTitle = document.getElementById('modal-title');
    const saveBtn = document.getElementById('save-note-btn');
    const titleInput = document.getElementById('note-title');
    const contentInput = document.getElementById('note-content');
    
    if (modalTitle) modalTitle.textContent = 'Edit Note';
    if (saveBtn) {
        const btnText = saveBtn.querySelector('.btn-text');
        if (btnText) btnText.textContent = 'Update Note';
    }
    if (titleInput) titleInput.value = note.title;
    if (contentInput) contentInput.value = note.content;
    
    showModal();
}

function handleSaveNote(e) {
    e.preventDefault();
    
    const titleInput = document.getElementById('note-title');
    const contentInput = document.getElementById('note-content');
    
    if (!titleInput || !contentInput) {
        showError('Form elements not found');
        return;
    }
    
    const title = titleInput.value.trim();
    const content = contentInput.value.trim();
    
    if (!title || !content) {
        showError('Please fill in both title and content');
        return;
    }
    
    const saveBtn = document.getElementById('save-note-btn');
    const loadingSpan = saveBtn?.querySelector('.btn-loading');
    const textSpan = saveBtn?.querySelector('.btn-text');
    
    try {
        if (saveBtn) saveBtn.disabled = true;
        if (loadingSpan) loadingSpan.classList.remove('hidden');
        if (textSpan) textSpan.style.opacity = '0.7';
        
        if (editingNoteId) {
            updateNote(editingNoteId, title, content);
            showSuccess('Note updated successfully! ✨');
        } else {
            createNote(title, content);
            showSuccess('Note created successfully! 🎉');
        }
        
        closeModal();
        notes = getNotes();
        renderNotes();
        updateDashboardUI();
        
    } catch (error) {
        console.error('Save note error:', error);
        showError(error.message || 'Failed to save note');
    } finally {
        if (saveBtn) saveBtn.disabled = false;
        if (loadingSpan) loadingSpan.classList.add('hidden');
        if (textSpan) textSpan.style.opacity = '1';
    }
}

function handleDeleteNote(noteId) {
    const note = notes.find(n => n.id === noteId);
    if (!note) {
        showError('Note not found');
        return;
    }
    
    const confirmDelete = confirm(`Are you sure you want to delete "${note.title}"?\n\nThis action cannot be undone.`);
    if (!confirmDelete) return;
    
    try {
        deleteNote(noteId);
        notes = getNotes();
        renderNotes();
        updateDashboardUI();
        showSuccess('Note deleted successfully');
    } catch (error) {
        console.error('Delete error:', error);
        showError(error.message || 'Failed to delete note');
    }
}

function handleUpgrade() {
    if (!currentUser || currentUser.role !== 'Admin') {
        showError('Only administrators can upgrade subscriptions');
        return;
    }
    
    if (!currentTenant) {
        showError('No tenant found');
        return;
    }
    
    if (currentTenant.plan === 'pro') {
        showInfo('Already on Pro plan! 🚀');
        return;
    }
    
    try {
        upgradeTenant(currentTenant.slug);
        updateDashboardUI();
        showSuccess('Successfully upgraded to Pro plan! 🚀 Enjoy unlimited notes!');
    } catch (error) {
        console.error('Upgrade error:', error);
        showError(error.message || 'Upgrade failed');
    }
}

// ==================== UI RENDERING ====================
function renderNotes() {
    const notesGrid = document.getElementById('notes-grid');
    const emptyState = document.getElementById('empty-state');
    const totalNotesDisplay = document.getElementById('total-notes-display');
    
    if (!notesGrid || !emptyState) return;
    
    if (totalNotesDisplay) {
        totalNotesDisplay.textContent = `${notes.length} ${notes.length === 1 ? 'note' : 'notes'}`;
    }
    
    if (notes.length === 0) {
        notesGrid.innerHTML = '';
        emptyState.classList.remove('hidden');
    } else {
        emptyState.classList.add('hidden');
        
        notesGrid.innerHTML = notes
            .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
            .map(note => {
                const user = TEST_ACCOUNTS.find(u => u.id === note.userId);
                return `
                    <div class="note-card" data-note-id="${note.id}">
                        <div class="note-card-header">
                            <h3 class="note-title">${escapeHtml(note.title)}</h3>
                            <div class="note-actions">
                                <button class="note-action-btn" data-action="edit" data-note-id="${note.id}" title="Edit note">
                                    ✏️
                                </button>
                                <button class="note-action-btn delete" data-action="delete" data-note-id="${note.id}" title="Delete note">
                                    🗑️
                                </button>
                            </div>
                        </div>
                        <div class="note-content">${escapeHtml(note.content)}</div>
                        <div class="note-footer">
                            <div class="note-date">
                                ${note.updatedAt !== note.createdAt ? 'Updated' : 'Created'} ${formatDate(note.updatedAt)}
                            </div>
                            <div class="note-author">
                                <div class="account-avatar" style="width: 20px; height: 20px; font-size: 10px;">${user?.avatar || 'U'}</div>
                                ${user?.name || 'Unknown'}
                            </div>
                        </div>
                    </div>
                `;
            })
            .join('');
        
        // Add event listeners
        document.querySelectorAll('[data-action="edit"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                editNote(e.currentTarget.dataset.noteId);
            });
        });
        
        document.querySelectorAll('[data-action="delete"]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                handleDeleteNote(e.currentTarget.dataset.noteId);
            });
        });
    }
}

function updateDashboardUI() {
    if (!currentUser || !currentTenant) return;
    
    // Update user info
    const userAvatar = document.getElementById('user-avatar');
    const userName = document.getElementById('user-name');
    const userTenant = document.getElementById('user-tenant');
    
    if (userAvatar) userAvatar.textContent = currentUser.avatar;
    if (userName) userName.textContent = currentUser.name;
    if (userTenant) {
        userTenant.textContent = `${currentTenant.name} • ${currentUser.role}`;
    }
    
    // Update plan info
    const planBadge = document.getElementById('plan-badge');
    const planName = document.getElementById('plan-name');
    const planDescription = document.getElementById('plan-description');
    
    if (currentTenant.plan === 'pro') {
        if (planBadge) {
            planBadge.textContent = 'PRO';
            planBadge.classList.add('pro');
        }
        if (planName) planName.textContent = 'Pro Plan';
        if (planDescription) planDescription.textContent = 'Unlimited notes with advanced features';
    } else {
        if (planBadge) {
            planBadge.textContent = 'FREE';
            planBadge.classList.remove('pro');
        }
        if (planName) planName.textContent = 'Free Plan';
        if (planDescription) planDescription.textContent = 'Basic notes with 3 note limit';
    }
    
    // Update usage stats
    const notesCount = document.getElementById('notes-count');
    const notesLimit = document.getElementById('notes-limit');
    const usageFill = document.getElementById('usage-fill');
    
    if (notesCount) notesCount.textContent = notes.length;
    
    if (currentTenant.plan === 'pro') {
        if (notesLimit) notesLimit.textContent = '∞';
        if (usageFill) {
            usageFill.style.width = '100%';
            usageFill.classList.remove('warning', 'danger');
        }
    } else {
        if (notesLimit) notesLimit.textContent = currentTenant.noteLimit;
        if (usageFill) {
            const percentage = Math.min((notes.length / currentTenant.noteLimit) * 100, 100);
            usageFill.style.width = `${percentage}%`;
            
            usageFill.classList.remove('warning', 'danger');
            if (percentage >= 100) {
                usageFill.classList.add('danger');
            } else if (percentage >= 80) {
                usageFill.classList.add('warning');
            }
        }
    }
    
    // Show/hide upgrade section
    const upgradeSection = document.getElementById('upgrade-section');
    if (upgradeSection) {
        const shouldShow = currentUser.role === 'Admin' && currentTenant.plan === 'free';
        upgradeSection.classList.toggle('hidden', !shouldShow);
    }
    
    // Show/hide limit warning - FIXED: Hide warning for Pro plan
    const limitWarning = document.getElementById('limit-warning');
    if (limitWarning) {
        const atLimit = currentTenant.plan === 'free' && notes.length >= currentTenant.noteLimit;
        limitWarning.classList.toggle('hidden', !atLimit);
    }
    
    // Update create button - FIXED: Always allow creation on Pro plan
    const createBtn = document.getElementById('create-note-btn');
    if (createBtn) {
        const limitCheck = checkNoteLimit(currentTenant.slug);
        createBtn.disabled = !limitCheck.canCreate;
        
        const btnText = createBtn.querySelector('span:last-child') || createBtn;
        if (limitCheck.canCreate) {
            btnText.textContent = 'Create Note';
        } else {
            btnText.textContent = 'Limit Reached';
        }
    }
}

// ==================== UI UTILITIES ====================
function showLoginPage() {
    const loginPage = document.getElementById('login-page');
    const dashboardPage = document.getElementById('dashboard-page');
    
    if (loginPage) loginPage.classList.remove('hidden');
    if (dashboardPage) dashboardPage.classList.add('hidden');
    
    clearError();
}

function showDashboard() {
    const loginPage = document.getElementById('login-page');
    const dashboardPage = document.getElementById('dashboard-page');
    
    if (loginPage) loginPage.classList.add('hidden');
    if (dashboardPage) dashboardPage.classList.remove('hidden');
    
    renderNotes();
    updateDashboardUI();
}

function showModal() {
    const modal = document.getElementById('note-modal');
    if (modal) {
        modal.classList.remove('hidden');
        setTimeout(() => {
            const titleInput = document.getElementById('note-title');
            if (titleInput) titleInput.focus();
        }, 100);
    }
}

function closeModal() {
    const modal = document.getElementById('note-modal');
    if (modal) modal.classList.add('hidden');
    editingNoteId = null;
}

// ==================== TOAST NOTIFICATIONS ====================
function showToast(message, type = 'info', title = null) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    
    toast.innerHTML = `
        <div class="toast-icon">${icons[type] || 'ℹ️'}</div>
        <div class="toast-content">
            ${title ? `<div class="toast-title">${escapeHtml(title)}</div>` : ''}
            <div class="toast-message">${escapeHtml(message)}</div>
        </div>
        <button class="toast-close">&times;</button>
    `;
    
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => removeToast(toast));
    
    container.appendChild(toast);
    setTimeout(() => removeToast(toast), 5000);
}

function removeToast(toast) {
    if (toast && toast.parentNode) {
        toast.parentNode.removeChild(toast);
    }
}

function showSuccess(message, title = null) {
    showToast(message, 'success', title);
}

function showError(message, title = 'Error') {
    showToast(message, 'error', title);
    const loginError = document.getElementById('login-error');
    if (loginError && !document.getElementById('login-page').classList.contains('hidden')) {
        loginError.textContent = message;
        loginError.classList.remove('hidden');
    }
}

function showWarning(message, title = 'Warning') {
    showToast(message, 'warning', title);
}

function showInfo(message, title = null) {
    showToast(message, 'info', title);
}

function clearError() {
    const loginError = document.getElementById('login-error');
    if (loginError) loginError.classList.add('hidden');
}

// ==================== UTILITY FUNCTIONS ====================
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 1) {
        return 'Yesterday at ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    } else if (diffDays < 7) {
        return `${diffDays} days ago`;
    } else {
        return date.toLocaleDateString() + ' at ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
    }
}

// ==================== EVENT BINDING ====================
function bindEventListeners() {
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
    
    document.querySelectorAll('.demo-account-btn').forEach(btn => {
        btn.addEventListener('click', handleQuickLogin);
    });
    
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
    
    const createBtn = document.getElementById('create-note-btn');
    if (createBtn) {
        createBtn.addEventListener('click', openCreateNoteModal);
    }
    
    const noteForm = document.getElementById('note-form');
    if (noteForm) {
        noteForm.addEventListener('submit', handleSaveNote);
    }
    
    const upgradeBtn = document.getElementById('upgrade-btn');
    if (upgradeBtn) {
        upgradeBtn.addEventListener('click', handleUpgrade);
    }
}

// Make closeModal globally available
window.closeModal = closeModal;

// ==================== EXPOSED API ====================
window.API = {
    health: () => ({ status: "ok" }),
    login: authenticateUser,
    logout: () => {
        currentUser = null;
        currentTenant = null;
        currentToken = null;
        return { success: true };
    },
    createNote: (data) => {
        if (!data.title || !data.content) {
            throw new Error('Title and content required');
        }
        return createNote(data.title, data.content);
    },
    getNotes: getNotes,
    getNote: getNote,
    updateNote: (id, data) => {
        if (!data.title || !data.content) {
            throw new Error('Title and content required');
        }
        return updateNote(id, data.title, data.content);
    },
    deleteNote: deleteNote,
    upgradeTenant: upgradeTenant,
    getCurrentUser: () => currentUser,
    getCurrentTenant: () => currentTenant,
    getCurrentNotes: () => notes
};

window.health = () => window.API.health();

// ==================== APP INITIALIZATION ====================
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 NotesAI Initializing...');
    
    try {
        bindEventListeners();
        showLoginPage();
        console.log('✅ NotesAI Ready - Login page displayed immediately!');
    } catch (error) {
        console.error('❌ Initialization failed:', error);
        showError('Application failed to initialize');
    }
});

console.log('🎯 NotesAI Loaded - Enterprise Notes Intelligence Platform Ready!');