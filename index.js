// =============================================================================
// TIMELINE TRACKER - Main Entry Point
// SillyTavern Extension for tracking story timeline and events
// =============================================================================

import { extension_settings, getContext, saveMetadataDebounced } from '../../../extensions.js';
import { saveSettingsDebounced, chat, chat_metadata, characters, this_chid, generateRaw } from '../../../../script.js';
import { world_info, world_names, loadWorldInfo, createWorldInfoEntry, saveWorldInfo, updateWorldInfoList, selected_world_info } from '../../../world-info.js';

const EXTENSION_NAME = 'timeline-tracker';
const DEBUG = true;

// Default settings
const defaultSettings = {
    enabled: true,
    mainLorebookName: '',
    subLorebookPrefix: 'Timeline_',
    autoKeywords: true,
    scanDepth: 50, // How many messages to scan
};

// Debug logger
function log(...args) {
    if (DEBUG) {
        console.log(`[${EXTENSION_NAME}]`, ...args);
    }
}

// =============================================================================
// INITIALIZATION
// =============================================================================

jQuery(async () => {
    log('🕐 Timeline Tracker initializing...');
    
    // Initialize settings
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = { ...defaultSettings };
    }
    
    // Load settings panel (inline - no external file needed)
    const settingsHtml = `
        <div class="timeline-tracker-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>🕐 Timeline Tracker</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div style="padding: 10px; display: flex; flex-direction: column; gap: 10px;">
                        <label style="display: flex; align-items: center; gap: 8px;">
                            <input type="checkbox" id="timeline-enabled" checked>
                            <span>활성화</span>
                        </label>
                        <button id="timeline-open-popup" class="menu_button">
                            <i class="fa-solid fa-clock-rotate-left"></i> 타임라인 생성
                        </button>
                        <small style="color: var(--SmartThemeFadedColor);">
                            채팅 내용을 분석하여 타임라인을 자동 생성합니다.
                        </small>
                    </div>
                </div>
            </div>
        </div>
    `;
    $('#extensions_settings').append(settingsHtml);
    
    // Settings panel button click
    $('#timeline-open-popup').on('click', () => {
        showTimelinePopup();
    });
    
    // Bind UI events
    bindUIEvents();
    
    // Add button to extensions menu or chat
    addTimelineButton();
    
    log('🕐 Timeline Tracker initialized!');
});

// =============================================================================
// UI SETUP
// =============================================================================

function addTimelineButton() {
    // Add button to the extensions/extras area
    const buttonHtml = `
        <div id="timeline-tracker-button" class="list-group-item flex-container flexGap5" title="Generate Timeline">
            <i class="fa-solid fa-clock-rotate-left"></i>
            <span>Timeline</span>
        </div>
    `;
    
    // Try to add to WI/Lorebook area or create floating button
    $('#extensionsMenu').append(buttonHtml);
    
    // Click handler
    $('#timeline-tracker-button').on('click', () => {
        showTimelinePopup();
    });
}

function bindUIEvents() {
    // Settings panel events
    $(document).on('change', '#timeline-enabled', function() {
        extension_settings[EXTENSION_NAME].enabled = $(this).is(':checked');
        saveSettingsDebounced();
    });
    
    $(document).on('change', '#timeline-main-lorebook', function() {
        extension_settings[EXTENSION_NAME].mainLorebookName = $(this).val();
        saveSettingsDebounced();
    });
    
    $(document).on('change', '#timeline-scan-depth', function() {
        extension_settings[EXTENSION_NAME].scanDepth = parseInt($(this).val()) || 50;
        saveSettingsDebounced();
    });
}

// =============================================================================
// MAIN POPUP UI
// =============================================================================

async function showTimelinePopup() {
    log('🕐 Opening Timeline popup...');
    
    const context = getContext();
    const chatLength = chat?.length || 0;
    const lastMsgId = chatLength > 0 ? chatLength - 1 : 0;
    
    // Get available lorebooks for dropdown
    const lorebookOptions = world_names.map(name => 
        `<option value="${name}">${name}</option>`
    ).join('');
    
    const popup = $(`
        <div class="timeline-popup-overlay">
            <div class="timeline-popup">
                <div class="timeline-popup-header">
                    <h3>🕐 Timeline Tracker</h3>
                    <button class="timeline-close-btn"><i class="fa-solid fa-times"></i></button>
                </div>
                
                <div class="timeline-popup-body">
                    <!-- Status -->
                    <div class="timeline-status">
                        <div class="timeline-status-item">
                            <i class="fa-solid fa-comments"></i>
                            <span>채팅 메시지: <strong>${chatLength}</strong>개 (ID: 0 ~ ${lastMsgId})</span>
                        </div>
                    </div>
                    
                    <!-- Step 1: Mode Selection -->
                    <div class="timeline-section">
                        <h4>① 타임라인 타입</h4>
                        <div class="timeline-mode-options">
                            <label class="timeline-mode-option">
                                <input type="radio" name="timeline-mode" value="main" checked>
                                <div class="timeline-mode-card">
                                    <i class="fa-solid fa-file-lines"></i>
                                    <div>
                                        <strong>메인 타임라인</strong>
                                        <span>기존 엔트리 content 아래에 이어붙이기 (Constant)</span>
                                    </div>
                                </div>
                            </label>
                            <label class="timeline-mode-option">
                                <input type="radio" name="timeline-mode" value="sub">
                                <div class="timeline-mode-card">
                                    <i class="fa-solid fa-plus"></i>
                                    <div>
                                        <strong>서브 타임라인</strong>
                                        <span>로어북에 새 엔트리 추가 (Selective + 키워드)</span>
                                    </div>
                                </div>
                            </label>
                        </div>
                    </div>
                    
                    <!-- Step 2: Lorebook Selection (Common) -->
                    <div class="timeline-section">
                        <h4>② 로어북 선택</h4>
                        <div class="timeline-form-group">
                            <label>대상 로어북</label>
                            <select id="timeline-target-lorebook" class="timeline-select">
                                <option value="">-- 로어북 선택 --</option>
                                ${lorebookOptions}
                            </select>
                        </div>
                    </div>
                    
                    <!-- Step 3: Entry Selection (Main only) -->
                    <div class="timeline-section timeline-main-options">
                        <h4>③ 엔트리 선택</h4>
                        <div class="timeline-form-group">
                            <label>붙여넣을 엔트리</label>
                            <select id="timeline-target-entry" class="timeline-select">
                                <option value="">-- 먼저 로어북을 선택하세요 --</option>
                            </select>
                            <span class="timeline-hint">선택한 엔트리의 content 아래에 타임라인이 추가됩니다</span>
                        </div>
                    </div>
                    
                    <!-- Step 3: New Entry Options (Sub only) -->
                    <div class="timeline-section timeline-sub-options" style="display: none;">
                        <h4>③ 새 엔트리 설정</h4>
                        <div class="timeline-form-group">
                            <label>엔트리 이름 (comment)</label>
                            <input type="text" id="timeline-entry-name" class="timeline-input" placeholder="📅 Timeline Event">
                        </div>
                        <div class="timeline-form-group">
                            <label>
                                <input type="checkbox" id="timeline-auto-keywords" checked>
                                키워드 자동 생성
                            </label>
                        </div>
                    </div>
                    
                    <!-- Step 4: Message Range -->
                    <div class="timeline-section">
                        <h4>④ 메시지 범위 (ID)</h4>
                        <div class="timeline-form-group" style="display: flex; gap: 10px; align-items: center;">
                            <input type="number" id="timeline-start-id" class="timeline-input" placeholder="시작 ID" value="0" min="0" max="${lastMsgId}" style="flex: 1;">
                            <span>~</span>
                            <input type="number" id="timeline-end-id" class="timeline-input" placeholder="끝 ID" value="${lastMsgId}" min="0" max="${lastMsgId}" style="flex: 1;">
                        </div>
                        <span class="timeline-hint">전체 범위: 0 ~ ${lastMsgId}</span>
                    </div>
                </div>
                
                <div class="timeline-popup-footer">
                    <button class="timeline-btn timeline-btn-secondary timeline-close-btn">취소</button>
                    <button class="timeline-btn timeline-btn-primary" id="timeline-generate-btn">
                        <i class="fa-solid fa-wand-magic-sparkles"></i> 타임라인 생성
                    </button>
                </div>
            </div>
        </div>
    `);
    
    $('body').append(popup);
    
    // Event handlers
    popup.find('.timeline-close-btn').on('click', () => popup.remove());
    popup.find('.timeline-popup-overlay').on('click', (e) => {
        if (e.target === e.currentTarget) popup.remove();
    });
    
    // Mode toggle
    popup.find('input[name="timeline-mode"]').on('change', function() {
        const mode = $(this).val();
        if (mode === 'main') {
            popup.find('.timeline-main-options').show();
            popup.find('.timeline-sub-options').hide();
        } else {
            popup.find('.timeline-main-options').hide();
            popup.find('.timeline-sub-options').show();
        }
    });
    
    // Lorebook selection -> Load entries
    popup.find('#timeline-target-lorebook').on('change', async function() {
        const lorebookName = $(this).val();
        const entrySelect = popup.find('#timeline-target-entry');
        
        if (!lorebookName) {
            entrySelect.html('<option value="">-- 먼저 로어북을 선택하세요 --</option>');
            return;
        }
        
        try {
            const lorebookData = await loadWorldInfo(lorebookName);
            const entries = lorebookData?.entries || {};
            
            let entryOptions = '<option value="">-- 엔트리 선택 --</option>';
            for (const [uid, entry] of Object.entries(entries)) {
                const comment = entry.comment || `Entry ${uid}`;
                const preview = (entry.content || '').substring(0, 50).replace(/\n/g, ' ');
                entryOptions += `<option value="${uid}">${comment} (${preview}...)</option>`;
            }
            
            entrySelect.html(entryOptions);
            log('🕐 Loaded entries for lorebook:', lorebookName, Object.keys(entries).length);
        } catch (error) {
            log('❌ Failed to load lorebook entries:', error);
            entrySelect.html('<option value="">-- 로드 실패 --</option>');
        }
    });
    
    // Generate button
    popup.find('#timeline-generate-btn').on('click', async () => {
        const mode = popup.find('input[name="timeline-mode"]:checked').val();
        const targetLorebook = popup.find('#timeline-target-lorebook').val();
        const startId = parseInt(popup.find('#timeline-start-id').val()) || 0;
        const endId = parseInt(popup.find('#timeline-end-id').val()) || lastMsgId;
        
        if (!targetLorebook) {
            toastr.warning('로어북을 선택해주세요!');
            return;
        }
        
        if (startId > endId) {
            toastr.warning('시작 ID가 끝 ID보다 큽니다!');
            return;
        }
        
        if (mode === 'main') {
            const targetEntry = popup.find('#timeline-target-entry').val();
            if (!targetEntry) {
                toastr.warning('엔트리를 선택해주세요!');
                return;
            }
            await generateMainTimeline(targetLorebook, targetEntry, startId, endId);
        } else {
            const entryName = popup.find('#timeline-entry-name').val().trim() || '📅 Timeline Event';
            const autoKeywords = popup.find('#timeline-auto-keywords').is(':checked');
            await generateSubTimeline(targetLorebook, entryName, startId, endId, autoKeywords);
        }
        
        popup.remove();
    });
}

// =============================================================================
// TIMELINE GENERATION
// =============================================================================

async function generateMainTimeline(lorebookName, entryUid, startId, endId) {
    log('🕐 Generating MAIN timeline...', { lorebookName, entryUid, startId, endId });
    
    toastr.info('타임라인 생성 중...');
    
    try {
        // 1. Get chat context by ID range
        const chatContext = getChatContextByRange(startId, endId);
        
        // 2. Generate timeline via AI
        const timelineContent = await generateTimelineViaAI(chatContext, 'main');
        
        if (!timelineContent) {
            toastr.error('타임라인 생성 실패');
            return;
        }
        
        // 3. Load lorebook and find target entry
        const lorebookData = await loadWorldInfo(lorebookName);
        if (!lorebookData || !lorebookData.entries[entryUid]) {
            toastr.error('엔트리를 찾을 수 없습니다');
            return;
        }
        
        // 4. Append to existing entry content
        const entry = lorebookData.entries[entryUid];
        const separator = '\n\n---\n\n';
        entry.content = entry.content + separator + timelineContent;
        
        // 5. Save lorebook
        await saveWorldInfo(lorebookName, lorebookData);
        await updateWorldInfoList();
        
        toastr.success('메인 타임라인이 추가되었습니다!');
        log('🕐 Main timeline appended successfully');
        
    } catch (error) {
        log('❌ Error generating main timeline:', error);
        toastr.error('타임라인 생성 중 오류 발생: ' + error.message);
    }
}

async function generateSubTimeline(lorebookName, entryName, startId, endId, autoKeywords) {
    log('🕐 Generating SUB timeline...', { lorebookName, entryName, startId, endId, autoKeywords });
    
    toastr.info('서브 타임라인 생성 중...');
    
    try {
        // 1. Get chat context by ID range
        const chatContext = getChatContextByRange(startId, endId);
        
        // 2. Generate timeline events via AI
        const eventData = await generateTimelineViaAI(chatContext, 'sub');
        
        if (!eventData) {
            toastr.error('타임라인 생성 실패');
            return;
        }
        
        // 3. Load existing lorebook
        const lorebookData = await loadWorldInfo(lorebookName);
        if (!lorebookData) {
            toastr.error('로어북을 찾을 수 없습니다');
            return;
        }
        
        // 4. Create new entry
        const uid = Date.now();
        const keywords = autoKeywords ? (eventData.keywords || []) : [];
        
        lorebookData.entries[uid] = {
            uid: uid,
            comment: entryName,
            content: eventData.content || eventData,
            constant: false,
            selective: true,
            key: keywords,
            keysecondary: [],
            order: 100,
            position: 4,
            depth: 4,
            scanDepth: 2,
            caseSensitive: false,
            matchWholeWords: false,
            disable: false,
            addMemo: true,
            excludeRecursion: true,
            preventRecursion: false,
            probability: 100,
            useProbability: true,
            group: '',
            groupOverride: false,
            groupWeight: 100,
            matchPersonaDescription: false,
            matchCharacterDescription: false,
            matchCharacterPersonality: false,
            matchCharacterDepthPrompt: false,
            matchScenario: false,
            matchCreatorNotes: false,
            delayUntilRecursion: false,
            automationId: '',
            sticky: 0,
            cooldown: 0,
            delay: 0,
            displayIndex: Object.keys(lorebookData.entries).length,
        };
        
        // 5. Save lorebook
        await saveWorldInfo(lorebookName, lorebookData);
        await updateWorldInfoList();
        
        const keywordText = keywords.length > 0 ? ` (키워드: ${keywords.join(', ')})` : '';
        toastr.success(`서브 타임라인 생성 완료!${keywordText}`);
        log('🕐 Sub timeline created successfully', { uid, keywords });
        
    } catch (error) {
        log('❌ Error generating sub timeline:', error);
        toastr.error('타임라인 생성 중 오류 발생: ' + error.message);
    }
}

// =============================================================================
// CHAT CONTEXT EXTRACTION
// =============================================================================

function getChatContextByRange(startId, endId) {
    const context = getContext();
    
    // Slice chat by ID range (inclusive)
    const messages = chat?.slice(startId, endId + 1) || [];
    
    log('🕐 Extracting chat context by range...', { startId, endId, extracted: messages.length });
    
    // Format messages for AI consumption
    const formattedMessages = messages.map((msg, idx) => {
        const actualId = startId + idx;
        const speaker = msg.is_user ? 'User' : (msg.name || 'Character');
        const content = msg.mes || '';
        return `[#${actualId}] [${speaker}]: ${content}`;
    }).join('\n\n');
    
    return {
        startId: startId,
        endId: endId,
        messageCount: messages.length,
        characterName: context.characters?.[context.characterId]?.name || 'Unknown',
        formattedChat: formattedMessages,
    };
}

// =============================================================================
// AI GENERATION
// =============================================================================

async function generateTimelineViaAI(chatContext, mode) {
    log('🕐 Requesting AI to generate timeline...', { mode, messageCount: chatContext.messageCount });
    
    const mainPrompt = `You are a timeline summarizer. Analyze the following roleplay chat and create a chronological timeline.

FORMAT YOUR RESPONSE EXACTLY LIKE THIS:

### **I. [Arc Title] ([Time Period])**
*   **[Event Name] ([Date/Time]):**
    *   **Event:** [What happened - detailed description]
    *   **Result:** [The outcome and its significance]
*   **[Next Event Name] ([Date/Time]):**
    *   **Event:** [What happened]
    *   **Result:** [The outcome]

### **II. [Next Arc Title] ([Time Period])**
[Continue same format...]

RULES:
- Group related events into numbered arcs (I, II, III...)
- Each arc should have a dramatic title and time period
- Include specific dates/times when mentioned
- Write in past tense, narrative style
- Capture emotional beats and relationship developments
- Be detailed but concise

CHAT LOG (Message ID ${chatContext.startId} ~ ${chatContext.endId}):
${chatContext.formattedChat}`;

    const subPrompt = `You are a timeline event extractor. Analyze the following roleplay chat and summarize it as a single timeline event.

RESPOND IN THIS EXACT JSON FORMAT:
{
    "content": "### **[Event Title] ([Date/Time])**\\n*   **Event:** [Detailed description of what happened]\\n*   **Result:** [The outcome and significance]",
    "keywords": ["keyword1", "keyword2", "키워드1", "키워드2"]
}

RULES:
- Summarize the entire chat segment as ONE coherent event
- Keywords should include English AND Korean variations
- Keywords: character names, location names, emotional keywords, key actions
- Keep keywords relevant for future reference triggers
- 4-8 keywords recommended

CHAT LOG (Message ID ${chatContext.startId} ~ ${chatContext.endId}):
${chatContext.formattedChat}`;

    const prompt = mode === 'main' ? mainPrompt : subPrompt;
    
    try {
        // Use SillyTavern's generateRaw for AI completion
        const response = await generateRaw(prompt, null, false, false);
        
        log('🕐 AI Response received', { length: response?.length });
        
        if (mode === 'sub') {
            // Parse JSON response for sub timeline
            try {
                const jsonMatch = response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
                // If JSON parse fails, return raw content
                return { content: response, keywords: [] };
            } catch (parseError) {
                log('⚠️ JSON parse failed, using raw content:', parseError);
                return { content: response, keywords: [] };
            }
        }
        
        return response;
        
    } catch (error) {
        log('❌ AI generation error:', error);
        throw error;
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    showTimelinePopup,
    generateMainTimeline,
    generateSubTimeline,
};
