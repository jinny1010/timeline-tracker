// Lorebook Organizer Extension for SillyTavern
// 로어북 자동 요약 및 정리

import {
    saveSettingsDebounced,
} from '../../../../script.js';

import { extension_settings } from '../../../extensions.js';
import { world_names, loadWorldInfo, saveWorldInfo } from '../../../world-info.js';

const getContext = () => SillyTavern.getContext();
const extensionName = 'lorebook-organizer';

const defaultSettings = {
    buttonPosition: 'sidebar',
    summaryRange: 'recent',
    recentMessageCount: 20,
    enabled: true,
};

let currentLoreBook = null;
let currentEntries = [];
let isProcessing = false;

// ========== 설정 ==========

function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = value;
        }
    }
}

function createSettingsUI() {
    const settingsHtml = `
        <div class="lo-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Lorebook Organizer</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div style="margin: 10px 0;">
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                            <input type="checkbox" id="lo_enabled" ${extension_settings[extensionName].enabled ? 'checked' : ''}>
                            <span>활성화</span>
                        </label>
                    </div>
                    <div style="margin: 10px 0;">
                        <label style="display:block; margin-bottom:5px;">버튼 위치</label>
                        <select id="lo_button_position" style="width:100%; padding:5px;">
                            <option value="input" ${extension_settings[extensionName].buttonPosition === 'input' ? 'selected' : ''}>입력창 옆</option>
                            <option value="sidebar" ${extension_settings[extensionName].buttonPosition === 'sidebar' ? 'selected' : ''}>사이드바</option>
                        </select>
                    </div>
                    <div style="margin: 10px 0;">
                        <label style="display:block; margin-bottom:5px;">요약 범위</label>
                        <select id="lo_summary_range" style="width:100%; padding:5px;">
                            <option value="recent" ${extension_settings[extensionName].summaryRange === 'recent' ? 'selected' : ''}>최근 N개 메시지</option>
                            <option value="all" ${extension_settings[extensionName].summaryRange === 'all' ? 'selected' : ''}>전체 대화</option>
                        </select>
                    </div>
                    <div id="lo_recent_count_wrapper" style="margin: 10px 0; ${extension_settings[extensionName].summaryRange !== 'recent' ? 'display:none;' : ''}">
                        <label style="display:block; margin-bottom:5px;">메시지 수</label>
                        <input type="number" id="lo_recent_count" min="1" max="100" value="${extension_settings[extensionName].recentMessageCount}" style="width:100%; padding:5px;">
                    </div>
                </div>
            </div>
        </div>
    `;
    
    $('#extensions_settings').append(settingsHtml);
    
    $('#lo_enabled').on('change', function() {
        extension_settings[extensionName].enabled = this.checked;
        saveSettingsDebounced();
        updateButtonPosition();
    });
    
    $('#lo_button_position').on('change', function() {
        extension_settings[extensionName].buttonPosition = $(this).val();
        saveSettingsDebounced();
        updateButtonPosition();
    });
    
    $('#lo_summary_range').on('change', function() {
        extension_settings[extensionName].summaryRange = $(this).val();
        saveSettingsDebounced();
        $('#lo_recent_count_wrapper').toggle($(this).val() === 'recent');
    });
    
    $('#lo_recent_count').on('change', function() {
        extension_settings[extensionName].recentMessageCount = parseInt($(this).val()) || 20;
        saveSettingsDebounced();
    });
}

// ========== UI ==========

function updateButtonPosition() {
    $('#lo_menu_container').remove();
    if (!extension_settings[extensionName].enabled) return;
    addMenuButtons();
}

function addMenuButtons() {
    $('#lo_menu_container').remove();
    const position = extension_settings[extensionName].buttonPosition;
    
    if (position === 'sidebar') {
        const buttonHtml = `
            <div id="lo_menu_container" class="extension_container interactable" tabindex="0">
                <div id="lo-main-btn" class="list-group-item flex-container flexGap5 interactable" tabindex="0">
                    <div class="fa-solid fa-book-bookmark extensionsMenuExtensionButton"></div>
                    <span>로어북 정리</span>
                </div>
            </div>
        `;
        $('#extensionsMenu').prepend(buttonHtml);
    } else {
        const buttonHtml = `
            <div id="lo_menu_container" class="lo-input-btn interactable" title="로어북 정리" tabindex="0">
                <i class="fa-solid fa-book-bookmark"></i>
            </div>
        `;
        $('#send_but_sheld').prepend(buttonHtml);
    }
    
    $('#lo-main-btn, #lo_menu_container.lo-input-btn').on('click', openLorebookSelector);
}

// ========== 유틸 ==========

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getCharacterLorebook() {
    const ctx = getContext();
    if (ctx.characterId === undefined) return null;
    const character = ctx.characters[ctx.characterId];
    return character?.data?.extensions?.world || null;
}

function getWorldInfoList() {
    return world_names || [];
}

async function getWorldInfoData(worldName) {
    try {
        return await loadWorldInfo(worldName);
    } catch (error) {
        console.error('[LO] Error:', error);
        return null;
    }
}

function getChatContent() {
    const ctx = getContext();
    const chat = ctx.chat || [];
    const settings = extension_settings[extensionName];
    
    let messages = settings.summaryRange === 'recent' 
        ? chat.slice(-settings.recentMessageCount) 
        : chat;
    
    return messages.map(msg => {
        const role = msg.is_user ? 'User' : (msg.is_system ? 'System' : 'Character');
        return `[${role}]: ${msg.mes}`;
    }).join('\n\n');
}

// ========== AI 생성 ==========

async function generateWithAI(prompt) {
    const ctx = getContext();
    
    try {
        // 방법 1: generateRaw
        if (typeof ctx.generateRaw === 'function') {
            const result = await ctx.generateRaw(prompt, null, false, false);
            if (result) return result;
        }
        
        // 방법 2: Generate 함수
        if (typeof ctx.Generate === 'function') {
            const result = await ctx.Generate('quiet', { quiet_prompt: prompt, skipWIAN: true });
            if (result) return result;
        }
        
        // 방법 3: executeSlashCommands
        if (typeof ctx.executeSlashCommands === 'function') {
            const escaped = prompt.replace(/\|/g, '\\|').replace(/"/g, '\\"');
            const result = await ctx.executeSlashCommands(`/genraw lock=on ${escaped}`);
            return result?.pipe || '';
        }
        
        throw new Error('No generation method available');
    } catch (error) {
        console.error('[LO] Generation error:', error);
        throw error;
    }
}

// ========== 팝업 ==========

async function showPopup(content, type = 'text', options = {}) {
    const ctx = getContext();
    const popup = ctx.callGenericPopup || ctx.callPopup;
    if (!popup) throw new Error('Popup not available');
    return await popup(content, type, '', options);
}

// ========== 메인 플로우 ==========

async function openLorebookSelector() {
    if (isProcessing) {
        toastr.warning('처리 중입니다.');
        return;
    }
    
    const ctx = getContext();
    if (ctx.characterId === undefined) {
        toastr.warning('캐릭터를 먼저 선택해주세요.');
        return;
    }
    
    const worldInfos = getWorldInfoList();
    const charLorebook = getCharacterLorebook();
    
    if (!worldInfos.length) {
        toastr.warning('로어북이 없습니다.');
        return;
    }
    
    const defaultWorld = charLorebook || worldInfos[0];
    
    toastr.info('로어북 로딩 중...');
    const worldData = await getWorldInfoData(defaultWorld);
    
    if (!worldData?.entries) {
        toastr.error('로어북을 불러올 수 없습니다.');
        return;
    }
    
    currentLoreBook = defaultWorld;
    currentEntries = Object.values(worldData.entries);
    
    let entriesHtml = '';
    currentEntries.forEach((entry, idx) => {
        const title = entry.comment || (Array.isArray(entry.key) ? entry.key[0] : entry.key) || `Entry ${entry.uid}`;
        const isTimeline = title.toLowerCase().includes('timeline');
        const keys = Array.isArray(entry.key) ? entry.key.slice(0, 3).join(', ') : '';
        
        entriesHtml += `
            <div class="lo-entry-item" data-index="${idx}" data-timeline="${isTimeline}"
                 style="padding:12px; margin:5px 0; background:var(--SmartThemeBlurTintColor); border-radius:8px; cursor:pointer; border:1px solid var(--SmartThemeBorderColor);">
                <div style="font-weight:600;">${isTimeline ? '📅' : '📝'} ${escapeHtml(title)}</div>
                <div style="font-size:0.85em; opacity:0.7; margin-top:3px;">${escapeHtml(keys)}</div>
            </div>
        `;
    });
    
    const popupHtml = `
        <div style="display:flex; flex-direction:column; gap:15px; min-width:400px;">
            <h3 style="margin:0; text-align:center;">📚 로어북 정리</h3>
            <div><strong>로어북:</strong> ${escapeHtml(defaultWorld)}</div>
            <div style="max-height:350px; overflow-y:auto; border:1px solid var(--SmartThemeBorderColor); border-radius:5px; padding:10px;">
                ${entriesHtml || '<p style="opacity:0.7; text-align:center;">항목 없음</p>'}
            </div>
            <p style="font-size:0.85em; opacity:0.7; text-align:center;">정리할 항목 클릭</p>
        </div>
    `;
    
    // 이벤트 핸들러
    $(document).off('click.lo').on('click.lo', '.lo-entry-item', async function(e) {
        e.stopPropagation();
        if (isProcessing) return;
        
        const idx = parseInt($(this).data('index'));
        const isTimeline = $(this).data('timeline') === true;
        const entry = currentEntries[idx];
        
        if (!entry) return;
        
        // 팝업 닫기
        $('.popup-button-ok, #dialogue_popup_ok').click();
        $(document).off('click.lo');
        
        await sleep(300);
        await processEntry(entry, isTimeline, currentLoreBook);
    });
    
    await showPopup(popupHtml, 'text', { wide: true });
    $(document).off('click.lo');
}

async function processEntry(entry, isTimeline, worldName) {
    if (isProcessing) return;
    isProcessing = true;
    
    try {
        if (isTimeline) {
            const storyType = await selectStoryType();
            if (!storyType) {
                isProcessing = false;
                return;
            }
            
            if (storyType === 'main') {
                await processMainTimeline(entry, worldName);
            } else {
                await processSubStory(entry, worldName);
            }
        } else {
            await processGenericEntry(entry, worldName);
        }
    } catch (error) {
        console.error('[LO] Error:', error);
        toastr.error('오류: ' + error.message);
    } finally {
        isProcessing = false;
    }
}

async function selectStoryType() {
    const html = `
        <div style="min-width:300px;">
            <h3 style="margin:0 0 15px; text-align:center;">📅 스토리 유형</h3>
            <label style="display:block; padding:15px; margin:5px 0; background:var(--SmartThemeBlurTintColor); border-radius:8px; cursor:pointer; border:1px solid var(--SmartThemeBorderColor);">
                <input type="radio" name="lo_story" value="main" checked> <strong>메인 스토리</strong>
                <div style="font-size:0.85em; opacity:0.7; margin-left:20px;">기존 타임라인에 추가</div>
            </label>
            <label style="display:block; padding:15px; margin:5px 0; background:var(--SmartThemeBlurTintColor); border-radius:8px; cursor:pointer; border:1px solid var(--SmartThemeBorderColor);">
                <input type="radio" name="lo_story" value="sub"> <strong>서브 스토리</strong>
                <div style="font-size:0.85em; opacity:0.7; margin-left:20px;">새 로어북 항목 생성</div>
            </label>
        </div>
    `;
    
    const result = await showPopup(html, 'confirm', { okButton: '확인', cancelButton: '취소' });
    return result ? $('input[name="lo_story"]:checked').val() : null;
}

// ========== 일반 항목 처리 ==========

async function processGenericEntry(entry, worldName) {
    const chatContent = getChatContent();
    if (!chatContent.trim()) {
        toastr.warning('대화 내용이 없습니다.');
        return;
    }
    
    const existingContent = entry.content || '';
    
    const prompt = `You are a lorebook editor for a roleplay game.

TASK: Analyze the CONVERSATION and UPDATE the existing lorebook entry with NEW information.

=== EXISTING LOREBOOK ENTRY ===
${existingContent}

=== RECENT CONVERSATION TO ANALYZE ===
${chatContent}

=== CRITICAL INSTRUCTIONS ===
1. READ the conversation carefully and extract NEW events, relationship changes, discoveries, or emotional developments
2. KEEP the exact same markdown format and section structure as the existing entry
3. ADD new information to the appropriate sections:
   - "Perception Evolution": Update how the character views the other person based on new events
   - "Information Known About": Add newly learned facts
   - "Key Moments & Turning Points": Add significant new events from the conversation
   - "Future Commitments": Update based on new promises or intentions
4. DO NOT just copy the existing entry - you MUST add new content from the conversation
5. Write in English only
6. If nothing significant happened, still note minor interactions or mood changes

OUTPUT the complete updated lorebook entry:`;

    toastr.info('AI 분석 중... 잠시 기다려주세요.');
    
    try {
        const englishResult = await generateWithAI(prompt);
        
        if (!englishResult?.trim()) {
            toastr.error('AI 응답이 비어있습니다.');
            return;
        }
        
        // 한글 번역도 생성
        toastr.info('한글 번역 생성 중...');
        const koreanPrompt = `Translate the following lorebook entry to Korean. Keep the markdown formatting intact.

${englishResult}

Output Korean translation only:`;
        
        let koreanResult = '';
        try {
            koreanResult = await generateWithAI(koreanPrompt);
        } catch (e) {
            koreanResult = '(번역 실패)';
        }
        
        await showEditModal(englishResult.trim(), koreanResult.trim(), entry, 'generic', worldName);
        
    } catch (error) {
        console.error('[LO] Error:', error);
        toastr.error('요약 생성 실패: ' + error.message);
    }
}

// ========== 메인 타임라인 ==========

async function processMainTimeline(entry, worldName) {
    const chatContent = getChatContent();
    if (!chatContent.trim()) {
        toastr.warning('대화 내용이 없습니다.');
        return;
    }
    
    const existingContent = entry.content || '';
    
    const prompt = `You are a timeline writer for a roleplay game.

TASK: Create a NEW timeline entry summarizing the events in the conversation.

=== EXISTING TIMELINE (for format reference) ===
${existingContent}

=== CONVERSATION TO SUMMARIZE ===
${chatContent}

=== INSTRUCTIONS ===
1. Follow the EXACT same format as the existing timeline
2. Summarize the KEY EVENTS that happened in the conversation
3. Include: what happened, emotional moments, important dialogue, relationship developments
4. Write in English
5. This will be APPENDED to the existing timeline

OUTPUT only the NEW timeline entry to add (not the whole timeline):`;

    toastr.info('타임라인 생성 중...');
    
    try {
        const englishResult = await generateWithAI(prompt);
        
        if (!englishResult?.trim()) {
            toastr.error('AI 응답이 비어있습니다.');
            return;
        }
        
        toastr.info('한글 번역 중...');
        const koreanPrompt = `Translate to Korean, keep formatting:\n\n${englishResult}`;
        let koreanResult = '';
        try {
            koreanResult = await generateWithAI(koreanPrompt);
        } catch (e) {
            koreanResult = '(번역 실패)';
        }
        
        await showEditModal(englishResult.trim(), koreanResult.trim(), entry, 'timeline-main', worldName);
        
    } catch (error) {
        toastr.error('타임라인 생성 실패');
    }
}

// ========== 서브 스토리 ==========

async function processSubStory(entry, worldName) {
    const chatContent = getChatContent();
    if (!chatContent.trim()) {
        toastr.warning('대화 내용이 없습니다.');
        return;
    }
    
    const prompt = `You are a sub-story writer for a roleplay game.

TASK: Create a standalone sub-story entry from this conversation.

=== CONVERSATION ===
${chatContent}

=== INSTRUCTIONS ===
1. First line must be: KEYWORDS: keyword1, keyword2, keyword3 (3-5 relevant trigger keywords)
2. Then write a detailed summary of this specific story/event
3. Include: setting, what happened, emotional beats, character interactions
4. Write in English
5. This will become a separate lorebook entry

OUTPUT format:
KEYWORDS: keyword1, keyword2, keyword3
[Your detailed sub-story summary here]`;

    toastr.info('서브 스토리 생성 중...');
    
    try {
        const englishResult = await generateWithAI(prompt);
        
        if (!englishResult?.trim()) {
            toastr.error('AI 응답이 비어있습니다.');
            return;
        }
        
        toastr.info('한글 번역 중...');
        const koreanPrompt = `Translate to Korean (keep KEYWORDS line in English):\n\n${englishResult}`;
        let koreanResult = '';
        try {
            koreanResult = await generateWithAI(koreanPrompt);
        } catch (e) {
            koreanResult = '(번역 실패)';
        }
        
        await showEditModal(englishResult.trim(), koreanResult.trim(), entry, 'timeline-sub', worldName);
        
    } catch (error) {
        toastr.error('서브 스토리 생성 실패');
    }
}

// ========== 편집 모달 (한글/영어) ==========

async function showEditModal(englishContent, koreanContent, originalEntry, mode, worldName) {
    // 서브스토리면 키워드 파싱
    let keywords = '';
    let engContent = englishContent;
    let korContent = koreanContent;
    
    if (mode === 'timeline-sub') {
        const engLines = englishContent.split('\n');
        if (engLines[0]?.toUpperCase().startsWith('KEYWORDS:')) {
            keywords = engLines[0].replace(/^KEYWORDS:\s*/i, '').trim();
            engContent = engLines.slice(1).join('\n').trim();
        }
        
        const korLines = koreanContent.split('\n');
        if (korLines[0]?.toUpperCase().startsWith('KEYWORDS:')) {
            korContent = korLines.slice(1).join('\n').trim();
        }
    }
    
    const keywordHtml = mode === 'timeline-sub' ? `
        <div style="margin-bottom:15px;">
            <label style="font-weight:600;">🏷️ 키워드 (쉼표 구분)</label>
            <input type="text" id="lo_keywords" value="${escapeHtml(keywords)}" 
                   style="width:100%; padding:8px; margin-top:5px; border-radius:5px; border:1px solid var(--SmartThemeBorderColor); background:var(--SmartThemeBlurTintColor); color:var(--SmartThemeBodyColor);">
        </div>
    ` : '';
    
    const modeLabel = mode === 'generic' ? '로어북 업데이트' : 
                      mode === 'timeline-main' ? '타임라인 추가' : '서브 스토리 생성';
    
    const html = `
        <div style="display:flex; flex-direction:column; gap:10px; min-width:700px; max-width:900px;">
            <h3 style="margin:0; text-align:center;">✏️ ${modeLabel} - 확인 및 수정</h3>
            
            <div style="padding:10px; background:rgba(255,193,7,0.1); border-radius:5px; border-left:3px solid #ffc107;">
                <strong>⚠️ 저장 전 확인하세요!</strong> 영어 내용이 로어북에 저장됩니다.
            </div>
            
            ${keywordHtml}
            
            <div style="display:flex; gap:15px;">
                <div style="flex:1;">
                    <label style="font-weight:600; display:block; margin-bottom:5px;">🇺🇸 English (저장될 내용)</label>
                    <textarea id="lo_english" rows="18" 
                              style="width:100%; padding:10px; border-radius:5px; border:1px solid var(--SmartThemeBorderColor); background:var(--SmartThemeBlurTintColor); color:var(--SmartThemeBodyColor); resize:vertical; font-size:13px;">${escapeHtml(engContent)}</textarea>
                </div>
                <div style="flex:1;">
                    <label style="font-weight:600; display:block; margin-bottom:5px;">🇰🇷 한글 (참고용)</label>
                    <textarea id="lo_korean" rows="18" readonly
                              style="width:100%; padding:10px; border-radius:5px; border:1px solid var(--SmartThemeBorderColor); background:var(--SmartThemeBlurTintColor); color:var(--SmartThemeBodyColor); resize:vertical; font-size:13px; opacity:0.8;">${escapeHtml(korContent)}</textarea>
                </div>
            </div>
        </div>
    `;
    
    const confirmed = await showPopup(html, 'confirm', { okButton: '💾 저장', cancelButton: '취소', wide: true, large: true });
    
    if (confirmed) {
        const finalContent = $('#lo_english').val();
        const finalKeywords = $('#lo_keywords').val() || '';
        
        await saveToLorebook(finalContent, finalKeywords, originalEntry, mode, worldName);
    }
}

// ========== 저장 ==========

async function saveToLorebook(content, keywords, originalEntry, mode, worldName) {
    try {
        const worldData = await getWorldInfoData(worldName);
        if (!worldData?.entries) {
            throw new Error('로어북 데이터 없음');
        }
        
        if (mode === 'timeline-sub') {
            // 새 항목 생성
            const keywordArray = keywords.split(',').map(k => k.trim()).filter(k => k);
            const newUid = Date.now();
            
            worldData.entries[newUid] = {
                uid: newUid,
                key: keywordArray,
                keysecondary: [],
                content: content,
                comment: `Sub-Story: ${keywordArray[0] || 'Untitled'}`,
                disable: false,
                constant: false,
                selective: true,
                selectiveLogic: 0,
                addMemo: true,
                order: 100,
                position: 0,
                probability: 100,
                useProbability: true,
            };
            
            await saveWorldInfo(worldName, worldData);
            toastr.success(`서브 스토리 생성됨: ${keywordArray.join(', ')}`);
            
        } else if (mode === 'timeline-main') {
            // 기존 타임라인에 추가
            const entry = findEntryByUid(worldData.entries, originalEntry.uid);
            if (entry) {
                entry.content = (entry.content || '') + '\n\n---\n\n' + content;
                await saveWorldInfo(worldName, worldData);
                toastr.success('타임라인 업데이트됨');
            }
            
        } else {
            // 일반 항목 교체
            const entry = findEntryByUid(worldData.entries, originalEntry.uid);
            if (entry) {
                entry.content = content;
                await saveWorldInfo(worldName, worldData);
                toastr.success('로어북 업데이트됨');
            }
        }
        
    } catch (error) {
        console.error('[LO] Save error:', error);
        toastr.error('저장 실패: ' + error.message);
    }
}

function findEntryByUid(entries, uid) {
    for (const entry of Object.values(entries)) {
        if (String(entry.uid) === String(uid)) return entry;
    }
    return null;
}

// ========== 초기화 ==========

jQuery(async () => {
    console.log('[Lorebook Organizer] Loading...');
    loadSettings();
    createSettingsUI();
    setTimeout(addMenuButtons, 1000);
    console.log('[Lorebook Organizer] Loaded!');
});
