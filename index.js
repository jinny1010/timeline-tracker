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
    
    // Load HTML settings panel
    const settingsHtml = await $.get(`/scripts/extensions/third-party/${EXTENSION_NAME}/settings.html`);
    $('#extensions_settings').append(settingsHtml);
    
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
    
    // Get available lorebooks for dropdown
    const lorebookOptions = world_names.map(name => 
        `<option value="${name}" ${name === extension_settings[EXTENSION_NAME].mainLorebookName ? 'selected' : ''}>${name}</option>`
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
                            <span>채팅 메시지: <strong>${chatLength}</strong>개</span>
                        </div>
                    </div>
                    
                    <!-- Mode Selection -->
                    <div class="timeline-section">
                        <h4>타임라인 타입</h4>
                        <div class="timeline-mode-options">
                            <label class="timeline-mode-option">
                                <input type="radio" name="timeline-mode" value="main" checked>
                                <div class="timeline-mode-card">
                                    <i class="fa-solid fa-book"></i>
                                    <div>
                                        <strong>메인 타임라인</strong>
                                        <span>전체 스토리를 기존 로어북에 추가 (Constant)</span>
                                    </div>
                                </div>
                            </label>
                            <label class="timeline-mode-option">
                                <input type="radio" name="timeline-mode" value="sub">
                                <div class="timeline-mode-card">
                                    <i class="fa-solid fa-bookmark"></i>
                                    <div>
                                        <strong>서브 타임라인</strong>
                                        <span>개별 이벤트를 새 로어북으로 (Selective + 키워드)</span>
                                    </div>
                                </div>
                            </label>
                        </div>
                    </div>
                    
                    <!-- Main Timeline Options -->
                    <div class="timeline-section timeline-main-options">
                        <h4>메인 타임라인 설정</h4>
                        <div class="timeline-form-group">
                            <label>추가할 로어북 선택</label>
                            <select id="timeline-target-lorebook" class="timeline-select">
                                <option value="">-- 로어북 선택 --</option>
                                ${lorebookOptions}
                            </select>
                        </div>
                    </div>
                    
                    <!-- Sub Timeline Options -->
                    <div class="timeline-section timeline-sub-options" style="display: none;">
                        <h4>서브 타임라인 설정</h4>
                        <div class="timeline-form-group">
                            <label>새 로어북 이름</label>
                            <input type="text" id="timeline-new-lorebook-name" class="timeline-input" placeholder="Timeline_Events">
                        </div>
                        <div class="timeline-form-group">
                            <label>
                                <input type="checkbox" id="timeline-auto-keywords" checked>
                                키워드 자동 생성
                            </label>
                        </div>
                    </div>
                    
                    <!-- Scan Range -->
                    <div class="timeline-section">
                        <h4>스캔 범위</h4>
                        <div class="timeline-form-group">
                            <label>최근 메시지 수</label>
                            <input type="number" id="timeline-scan-count" class="timeline-input" value="${Math.min(chatLength, 50)}" min="1" max="${chatLength}">
                            <span class="timeline-hint">전체 ${chatLength}개 중</span>
                        </div>
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
    
    // Generate button
    popup.find('#timeline-generate-btn').on('click', async () => {
        const mode = popup.find('input[name="timeline-mode"]:checked').val();
        const scanCount = parseInt(popup.find('#timeline-scan-count').val()) || 50;
        
        if (mode === 'main') {
            const targetLorebook = popup.find('#timeline-target-lorebook').val();
            if (!targetLorebook) {
                toastr.warning('로어북을 선택해주세요!');
                return;
            }
            await generateMainTimeline(targetLorebook, scanCount);
        } else {
            const newLorebookName = popup.find('#timeline-new-lorebook-name').val().trim();
            if (!newLorebookName) {
                toastr.warning('로어북 이름을 입력해주세요!');
                return;
            }
            const autoKeywords = popup.find('#timeline-auto-keywords').is(':checked');
            await generateSubTimeline(newLorebookName, scanCount, autoKeywords);
        }
        
        popup.remove();
    });
}

// =============================================================================
// TIMELINE GENERATION
// =============================================================================

async function generateMainTimeline(targetLorebookName, scanCount) {
    log('🕐 Generating MAIN timeline...', { targetLorebookName, scanCount });
    
    toastr.info('타임라인 생성 중...');
    
    try {
        // 1. Get chat context
        const chatContext = getChatContext(scanCount);
        
        // 2. Generate timeline via AI
        const timelineContent = await generateTimelineViaAI(chatContext, 'main');
        
        if (!timelineContent) {
            toastr.error('타임라인 생성 실패');
            return;
        }
        
        // 3. Add to existing lorebook as constant entry
        await addToLorebook(targetLorebookName, {
            comment: '📅 Main Timeline',
            content: timelineContent,
            constant: true,
            selective: false,
            key: [],
            order: 100,
            position: 4,
            depth: 4,
        });
        
        toastr.success('메인 타임라인이 생성되었습니다!');
        log('🕐 Main timeline created successfully');
        
    } catch (error) {
        log('❌ Error generating main timeline:', error);
        toastr.error('타임라인 생성 중 오류 발생: ' + error.message);
    }
}

async function generateSubTimeline(lorebookName, scanCount, autoKeywords) {
    log('🕐 Generating SUB timeline...', { lorebookName, scanCount, autoKeywords });
    
    toastr.info('서브 타임라인 생성 중...');
    
    try {
        // 1. Get chat context
        const chatContext = getChatContext(scanCount);
        
        // 2. Generate timeline events via AI
        const eventsData = await generateTimelineViaAI(chatContext, 'sub');
        
        if (!eventsData || !eventsData.events) {
            toastr.error('타임라인 생성 실패');
            return;
        }
        
        // 3. Create new lorebook
        const lorebookData = { entries: {} };
        
        // 4. Add each event as separate entry with keywords
        for (let i = 0; i < eventsData.events.length; i++) {
            const event = eventsData.events[i];
            const uid = Date.now() + i;
            
            lorebookData.entries[uid] = {
                uid: uid,
                comment: `📅 ${event.title}`,
                content: event.content,
                constant: false,
                selective: true,
                key: event.keywords || [],
                keysecondary: [],
                order: 100 + i,
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
            };
        }
        
        // 5. Save lorebook
        await saveWorldInfo(lorebookName, lorebookData);
        await updateWorldInfoList();
        
        toastr.success(`서브 타임라인 생성 완료! (${eventsData.events.length}개 이벤트)`);
        log('🕐 Sub timeline created successfully', { eventCount: eventsData.events.length });
        
    } catch (error) {
        log('❌ Error generating sub timeline:', error);
        toastr.error('타임라인 생성 중 오류 발생: ' + error.message);
    }
}

// =============================================================================
// CHAT CONTEXT EXTRACTION
// =============================================================================

function getChatContext(messageCount) {
    const context = getContext();
    const messages = chat?.slice(-messageCount) || [];
    
    log('🕐 Extracting chat context...', { totalMessages: chat?.length, extracting: messageCount });
    
    // Format messages for AI consumption
    const formattedMessages = messages.map((msg, idx) => {
        const speaker = msg.is_user ? 'User' : (msg.name || 'Character');
        const content = msg.mes || '';
        return `[${speaker}]: ${content}`;
    }).join('\n\n');
    
    return {
        messageCount: messages.length,
        characterName: context.characters?.[context.characterId]?.name || 'Unknown',
        formattedChat: formattedMessages,
    };
}

// =============================================================================
// AI GENERATION
// =============================================================================

async function generateTimelineViaAI(chatContext, mode) {
    log('🕐 Requesting AI to generate timeline...', { mode });
    
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

CHAT LOG:
${chatContext.formattedChat}`;

    const subPrompt = `You are a timeline event extractor. Analyze the following roleplay chat and extract individual significant events.

RESPOND IN THIS EXACT JSON FORMAT:
{
    "events": [
        {
            "title": "The First Encounter",
            "content": "### **The First Encounter (Mid-May 2025)**\\n*   **Event:** [Detailed description]\\n*   **Result:** [Outcome]",
            "keywords": ["first meeting", "첫 만남", "encounter", "The Sanctum"]
        },
        {
            "title": "Event Title 2",
            "content": "...",
            "keywords": ["keyword1", "keyword2"]
        }
    ]
}

RULES:
- Extract 3-10 significant events
- Each event should be self-contained
- Keywords should include English AND Korean variations
- Keywords should be things characters might mention later
- Include location names, character names, emotional keywords

CHAT LOG:
${chatContext.formattedChat}`;

    const prompt = mode === 'main' ? mainPrompt : subPrompt;
    
    try {
        // Use SillyTavern's generateRaw for AI completion
        const response = await generateRaw(prompt, null, false, false);
        
        log('🕐 AI Response received', { length: response?.length });
        
        if (mode === 'sub') {
            // Parse JSON response for sub timeline
            try {
                // Extract JSON from response (in case there's extra text)
                const jsonMatch = response.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
            } catch (parseError) {
                log('❌ Failed to parse AI response as JSON:', parseError);
                return null;
            }
        }
        
        return response;
        
    } catch (error) {
        log('❌ AI generation error:', error);
        throw error;
    }
}

// =============================================================================
// LOREBOOK MANAGEMENT
// =============================================================================

async function addToLorebook(lorebookName, entryConfig) {
    log('🕐 Adding entry to lorebook...', { lorebookName });
    
    // Load existing lorebook
    const lorebookData = await loadWorldInfo(lorebookName);
    
    if (!lorebookData) {
        throw new Error(`로어북 "${lorebookName}"을 찾을 수 없습니다.`);
    }
    
    // Create new entry
    const uid = Date.now();
    lorebookData.entries[uid] = {
        uid: uid,
        comment: entryConfig.comment || 'Timeline Entry',
        content: entryConfig.content || '',
        constant: entryConfig.constant ?? false,
        selective: entryConfig.selective ?? true,
        key: entryConfig.key || [],
        keysecondary: [],
        order: entryConfig.order || 100,
        position: entryConfig.position || 4,
        depth: entryConfig.depth || 4,
        scanDepth: entryConfig.scanDepth || null,
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
        // Additional ST fields
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
    
    // Save lorebook
    await saveWorldInfo(lorebookName, lorebookData);
    await updateWorldInfoList();
    
    log('🕐 Entry added successfully', { uid });
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
    showTimelinePopup,
    generateMainTimeline,
    generateSubTimeline,
};
