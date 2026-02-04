// Lorebook Organizer Extension for SillyTavern
// 로어북 자동 요약 및 정리

import {
    saveSettingsDebounced,
} from '../../../../script.js';

import { extension_settings } from '../../../extensions.js';
import { world_names, loadWorldInfo, saveWorldInfo } from '../../../world-info.js';

// SillyTavern context에서 함수들 가져오기
const getContext = () => SillyTavern.getContext();
const getCallPopup = () => getContext().callPopup;
const executeSlashCommands = (cmd) => getContext().executeSlashCommands(cmd);

const extensionName = 'lorebook-organizer';

// 기본 설정
const defaultSettings = {
    buttonPosition: 'sidebar', // 'input' | 'sidebar' | 'message'
    summaryRange: 'recent', // 'recent' | 'all' | 'manual'
    recentMessageCount: 20,
    enabled: true,
};

// 상태
let currentLoreBook = null;
let currentEntries = [];

/**
 * 설정 초기화
 */
function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = value;
        }
    }
}

/**
 * 설정 UI 생성
 */
function createSettingsUI() {
    const settingsHtml = `
        <div class="lo-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Lorebook Organizer</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="lo-setting-item" style="margin: 10px 0;">
                        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                            <input type="checkbox" id="lo_enabled" ${extension_settings[extensionName].enabled ? 'checked' : ''}>
                            <span>활성화</span>
                        </label>
                    </div>
                    
                    <div class="lo-setting-item" style="margin: 10px 0;">
                        <label style="display:block; margin-bottom:5px;">버튼 위치</label>
                        <select id="lo_button_position" style="width:100%; padding:5px;">
                            <option value="input" ${extension_settings[extensionName].buttonPosition === 'input' ? 'selected' : ''}>입력창 옆</option>
                            <option value="sidebar" ${extension_settings[extensionName].buttonPosition === 'sidebar' ? 'selected' : ''}>사이드바</option>
                        </select>
                    </div>
                    
                    <div class="lo-setting-item" style="margin: 10px 0;">
                        <label style="display:block; margin-bottom:5px;">요약 범위</label>
                        <select id="lo_summary_range" style="width:100%; padding:5px;">
                            <option value="recent" ${extension_settings[extensionName].summaryRange === 'recent' ? 'selected' : ''}>최근 N개 메시지</option>
                            <option value="all" ${extension_settings[extensionName].summaryRange === 'all' ? 'selected' : ''}>전체 대화</option>
                        </select>
                    </div>
                    
                    <div class="lo-setting-item" id="lo_recent_count_wrapper" style="margin: 10px 0; ${extension_settings[extensionName].summaryRange !== 'recent' ? 'display:none;' : ''}">
                        <label style="display:block; margin-bottom:5px;">메시지 수</label>
                        <input type="number" id="lo_recent_count" min="1" max="100" value="${extension_settings[extensionName].recentMessageCount}" style="width:100%; padding:5px;">
                    </div>
                </div>
            </div>
        </div>
    `;
    
    $('#extensions_settings').append(settingsHtml);
    
    // 이벤트 바인딩
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
        if ($(this).val() === 'recent') {
            $('#lo_recent_count_wrapper').show();
        } else {
            $('#lo_recent_count_wrapper').hide();
        }
    });
    
    $('#lo_recent_count').on('change', function() {
        extension_settings[extensionName].recentMessageCount = parseInt($(this).val()) || 20;
        saveSettingsDebounced();
    });
}

/**
 * 버튼 위치 업데이트
 */
function updateButtonPosition() {
    // 기존 버튼 제거
    $('#lo_menu_container').remove();
    
    if (!extension_settings[extensionName].enabled) return;
    
    addMenuButtons();
}

/**
 * 메뉴 버튼 추가
 */
function addMenuButtons() {
    $('#lo_menu_container').remove();
    
    const position = extension_settings[extensionName].buttonPosition;
    
    if (position === 'sidebar') {
        const buttonHtml = `
            <div id="lo_menu_container" class="extension_container interactable" tabindex="0">
                <div id="lo-main-btn" class="list-group-item flex-container flexGap5 interactable" tabindex="0" role="listitem">
                    <div class="fa-solid fa-book-bookmark extensionsMenuExtensionButton"></div>
                    <span>로어북 정리</span>
                </div>
            </div>
        `;
        $('#extensionsMenu').prepend(buttonHtml);
    } else if (position === 'input') {
        const buttonHtml = `
            <div id="lo_menu_container" class="lo-input-btn interactable" title="로어북 정리" tabindex="0">
                <i class="fa-solid fa-book-bookmark"></i>
            </div>
        `;
        $('#send_but_sheld').prepend(buttonHtml);
    }
    
    $('#lo-main-btn, #lo_menu_container.lo-input-btn').on('click', openLorebookSelector);
}

/**
 * 캐릭터 로어북 가져오기
 */
function getCharacterLorebook() {
    const ctx = getContext();
    
    if (ctx.characterId === undefined) {
        return null;
    }
    
    const character = ctx.characters[ctx.characterId];
    if (!character) return null;
    
    // 캐릭터에 연결된 로어북
    return character.data?.extensions?.world || null;
}

/**
 * World Info 목록 가져오기 (import한 world_names 사용)
 */
function getWorldInfoList() {
    return world_names || [];
}

/**
 * World Info 데이터 가져오기
 */
async function getWorldInfoData(worldName) {
    try {
        const data = await loadWorldInfo(worldName);
        console.log('[LO] Loaded world info for', worldName, ':', data);
        return data;
    } catch (error) {
        console.error('[LO] Error getting world info:', error);
    }
    return null;
}

/**
 * 로어북 선택 팝업 열기
 */
async function openLorebookSelector() {
    const ctx = getContext();
    
    console.log('[LO] Opening selector, characterId:', ctx.characterId);
    
    if (ctx.characterId === undefined) {
        toastr.warning('캐릭터를 먼저 선택해주세요.');
        return;
    }
    
    // 캐릭터에 연결된 로어북 확인
    const charLorebook = getCharacterLorebook();
    
    // 전체 World Info 목록
    const worldInfos = getWorldInfoList();
    
    console.log('[LO] Character lorebook:', charLorebook);
    console.log('[LO] All world infos:', worldInfos);
    
    if (!charLorebook && (!worldInfos || worldInfos.length === 0)) {
        toastr.warning('사용 가능한 로어북이 없습니다.');
        return;
    }
    
    // 캐릭터 로어북이 있으면 그걸 기본으로
    const defaultWorld = charLorebook || worldInfos[0];
    
    const popupContent = `
        <div style="display:flex; flex-direction:column; gap:15px; min-width:400px;">
            <h3 style="margin:0; text-align:center;">📚 로어북 정리</h3>
            
            <div>
                <label style="display:block; margin-bottom:5px;">로어북 선택:</label>
                <select id="lo_world_select" style="width:100%; padding:8px; border-radius:5px; border:1px solid var(--SmartThemeBorderColor); background:var(--SmartThemeBlurTintColor); color:var(--SmartThemeBodyColor);">
                    ${worldInfos.map(w => `<option value="${w}" ${w === charLorebook ? 'selected' : ''}>${w}</option>`).join('')}
                </select>
            </div>
            
            <div id="lo_entries_container" style="max-height:300px; overflow-y:auto; border:1px solid var(--SmartThemeBorderColor); border-radius:5px; padding:10px; background:var(--SmartThemeBlurTintColor);">
                <p style="text-align:center; opacity:0.7;">로어북을 선택하면 항목이 표시됩니다...</p>
            </div>
        </div>
    `;
    
    // 로어북 선택 변경 이벤트
    $(document).off('change', '#lo_world_select').on('change', '#lo_world_select', async function() {
        const worldName = $(this).val();
        await loadWorldInfoEntries(worldName);
    });
    
    // 엔트리 클릭 이벤트
    $(document).off('click', '.lo-entry-item').on('click', '.lo-entry-item', async function() {
        const uid = $(this).data('uid');
        const isTimeline = $(this).data('is-timeline') === true || $(this).data('is-timeline') === 'true';
        const worldName = $('#lo_world_select').val();
        
        // 팝업 닫기
        $('#dialogue_popup_ok').trigger('click');
        
        const entry = currentEntries.find(e => String(e.uid) === String(uid));
        
        if (entry) {
            await processSelectedEntry(entry, isTimeline, worldName);
        }
    });
    
    await getCallPopup()(popupContent, 'text', '', { wide: true });
    
    // 초기 로드
    if (charLorebook) {
        await loadWorldInfoEntries(charLorebook);
    } else if (worldInfos.length > 0) {
        await loadWorldInfoEntries(worldInfos[0]);
    }
}

/**
 * World Info 엔트리 로드
 */
async function loadWorldInfoEntries(worldName) {
    const container = $('#lo_entries_container');
    container.html('<p style="text-align:center; opacity:0.7;">로딩 중...</p>');
    
    const worldData = await getWorldInfoData(worldName);
    
    if (!worldData || !worldData.entries) {
        container.html('<p style="text-align:center; opacity:0.7;">항목이 없습니다.</p>');
        return;
    }
    
    currentLoreBook = worldName;
    currentEntries = Object.values(worldData.entries);
    
    if (currentEntries.length === 0) {
        container.html('<p style="text-align:center; opacity:0.7;">항목이 없습니다.</p>');
        return;
    }
    
    let html = '';
    currentEntries.forEach((entry) => {
        const title = entry.comment || entry.key?.[0] || `Entry ${entry.uid}`;
        const isTimeline = title.toLowerCase().includes('timeline');
        const keys = Array.isArray(entry.key) ? entry.key : (entry.key ? [entry.key] : []);
        
        html += `
            <div class="lo-entry-item" data-uid="${entry.uid}" data-is-timeline="${isTimeline}" 
                 style="padding:12px; margin:5px 0; background:var(--SmartThemeBlurTintColor); border-radius:8px; cursor:pointer; border:1px solid var(--SmartThemeBorderColor);">
                <div style="font-weight:600;">${isTimeline ? '📅 ' : ''}${title}</div>
                <div style="font-size:0.85em; opacity:0.7; margin-top:3px;">${keys.slice(0, 3).join(', ')}</div>
            </div>
        `;
    });
    
    container.html(html);
}

/**
 * 선택된 로어북 항목 처리
 */
async function processSelectedEntry(entry, isTimeline, worldName) {
    if (isTimeline) {
        // 타임라인: 메인/서브 선택
        const storyType = await selectStoryType();
        if (!storyType) return;
        
        await processTimeline(entry, storyType, worldName);
    } else {
        // 일반 항목 (Relationship 등)
        await processGenericEntry(entry, worldName);
    }
}

/**
 * 메인/서브 스토리 선택
 */
async function selectStoryType() {
    const html = `
        <div style="display:flex; flex-direction:column; gap:15px; min-width:300px;">
            <h3 style="margin:0; text-align:center;">📅 스토리 유형 선택</h3>
            <div style="display:flex; flex-direction:column; gap:10px;">
                <label style="display:flex; flex-direction:column; padding:15px; background:var(--SmartThemeBlurTintColor); border-radius:8px; cursor:pointer; border:1px solid var(--SmartThemeBorderColor);">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <input type="radio" name="lo_story_type" value="main" checked>
                        <span style="font-weight:600;">메인 스토리</span>
                    </div>
                    <small style="opacity:0.7; margin-left:25px;">기존 타임라인에 이어붙임</small>
                </label>
                <label style="display:flex; flex-direction:column; padding:15px; background:var(--SmartThemeBlurTintColor); border-radius:8px; cursor:pointer; border:1px solid var(--SmartThemeBorderColor);">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <input type="radio" name="lo_story_type" value="sub">
                        <span style="font-weight:600;">서브 스토리</span>
                    </div>
                    <small style="opacity:0.7; margin-left:25px;">새 로어북 항목 생성 + 키워드 자동</small>
                </label>
            </div>
        </div>
    `;
    
    const result = await getCallPopup()(html, 'confirm', '', { okButton: '확인', cancelButton: '취소' });
    
    if (result) {
        return $('input[name="lo_story_type"]:checked').val();
    }
    return null;
}

/**
 * 대화 내용 가져오기
 */
function getChatContent() {
    const ctx = getContext();
    const chat = ctx.chat || [];
    const settings = extension_settings[extensionName];
    
    let messages = [];
    
    switch (settings.summaryRange) {
        case 'recent':
            messages = chat.slice(-settings.recentMessageCount);
            break;
        case 'all':
            messages = chat;
            break;
        default:
            messages = chat.slice(-20);
    }
    
    return messages.map(msg => {
        const role = msg.is_user ? 'User' : (msg.is_system ? 'System' : 'Character');
        return `[${role}]: ${msg.mes}`;
    }).join('\n\n');
}

/**
 * AI로 요약 생성 (/genraw 사용)
 */
async function generateSummary(prompt) {
    try {
        toastr.info('AI가 요약 중입니다...');
        
        // /genraw 명령어로 AI 호출
        const result = await executeSlashCommands(`/genraw ${prompt}`);
        
        if (result && result.pipe) {
            return result.pipe;
        }
        
        return result || '';
    } catch (error) {
        console.error('[LO] Generate error:', error);
        throw error;
    }
}

/**
 * 일반 항목 처리 (Relationship 등)
 */
async function processGenericEntry(entry, worldName) {
    const chatContent = getChatContent();
    const existingContent = entry.content || '';
    
    const prompt = `You are a story summarizer. Analyze the following conversation and update the existing entry.

EXISTING ENTRY FORMAT AND CONTENT:
${existingContent}

RECENT CONVERSATION:
${chatContent}

INSTRUCTIONS:
1. Maintain the EXACT same format as the existing entry
2. Update or add new information based on the conversation
3. Merge seamlessly with existing content
4. Write in English
5. Keep the same style, structure, and organization

OUTPUT only the updated entry content, nothing else:`;

    try {
        const result = await generateSummary(prompt);
        await openEditModal(result, entry, 'generic', worldName);
    } catch (error) {
        console.error('[LO] Error:', error);
        toastr.error('요약 생성 실패: ' + error.message);
    }
}

/**
 * 타임라인 처리
 */
async function processTimeline(entry, storyType, worldName) {
    const chatContent = getChatContent();
    const existingContent = entry.content || '';
    
    if (storyType === 'main') {
        const prompt = `You are a story summarizer. Create a timeline entry for the recent events.

EXISTING TIMELINE FORMAT:
${existingContent}

RECENT CONVERSATION:
${chatContent}

INSTRUCTIONS:
1. Follow the EXACT same format as the existing timeline
2. Summarize the key events from the conversation
3. This will be APPENDED to the existing timeline
4. Write in English
5. Include relevant dates/times if mentioned

OUTPUT only the new timeline entry to append:`;

        try {
            const result = await generateSummary(prompt);
            await openEditModal(result, entry, 'timeline-main', worldName);
        } catch (error) {
            console.error('[LO] Error:', error);
            toastr.error('요약 생성 실패');
        }
    } else {
        const prompt = `You are a story summarizer. Create a new sub-story entry.

MAIN TIMELINE FORMAT (for reference):
${existingContent}

RECENT CONVERSATION:
${chatContent}

INSTRUCTIONS:
1. Create a standalone sub-story summary
2. Write in English
3. Suggest 3-5 relevant keywords for this sub-story (comma separated)
4. Format your response as:
KEYWORDS: keyword1, keyword2, keyword3
CONTENT:
[Your summary here]`;

        try {
            const result = await generateSummary(prompt);
            await openEditModal(result, entry, 'timeline-sub', worldName);
        } catch (error) {
            console.error('[LO] Error:', error);
            toastr.error('요약 생성 실패');
        }
    }
}

/**
 * 편집 모달 열기
 */
async function openEditModal(content, originalEntry, mode, worldName) {
    let keywords = '';
    let mainContent = content;
    
    // 서브 스토리인 경우 키워드 파싱
    if (mode === 'timeline-sub') {
        const keywordMatch = content.match(/KEYWORDS:\s*(.+)/i);
        const contentMatch = content.match(/CONTENT:\s*([\s\S]+)/i);
        
        if (keywordMatch) keywords = keywordMatch[1].trim();
        if (contentMatch) mainContent = contentMatch[1].trim();
    }
    
    const html = `
        <div style="display:flex; flex-direction:column; gap:15px; min-width:500px;">
            <h3 style="margin:0; text-align:center;">✏️ 내용 확인 및 수정</h3>
            <p style="margin:0; padding:8px; background:rgba(255,193,7,0.1); border-radius:5px; border-left:3px solid #ffc107; font-size:0.9em;">
                저장은 영어로 됩니다. 확인 후 수정하세요.
            </p>
            
            ${mode === 'timeline-sub' ? `
                <div>
                    <label style="display:block; margin-bottom:5px;">키워드 (쉼표로 구분)</label>
                    <input type="text" id="lo_edit_keywords" value="${keywords}" 
                           style="width:100%; padding:10px; border-radius:5px; border:1px solid var(--SmartThemeBorderColor); background:var(--SmartThemeBlurTintColor); color:var(--SmartThemeBodyColor);">
                </div>
            ` : ''}
            
            <div>
                <label style="display:block; margin-bottom:5px;">내용</label>
                <textarea id="lo_edit_content" rows="15" 
                          style="width:100%; padding:10px; border-radius:5px; border:1px solid var(--SmartThemeBorderColor); background:var(--SmartThemeBlurTintColor); color:var(--SmartThemeBodyColor); resize:vertical;">${mainContent}</textarea>
            </div>
        </div>
    `;
    
    const confirmed = await getCallPopup()(html, 'confirm', '', { okButton: '저장', cancelButton: '취소', wide: true });
    
    if (confirmed) {
        const finalContent = $('#lo_edit_content').val();
        const finalKeywords = $('#lo_edit_keywords').val() || '';
        
        await saveToLorebook(finalContent, finalKeywords, originalEntry, mode, worldName);
    }
}

/**
 * 로어북에 저장
 */
async function saveToLorebook(content, keywords, originalEntry, mode, worldName) {
    try {
        if (mode === 'timeline-sub') {
            // 새 로어북 항목 생성
            const keywordArray = keywords.split(',').map(k => k.trim()).filter(k => k);
            
            // 기존 worldData 가져오기
            const worldData = await getWorldInfoData(worldName);
            if (!worldData || !worldData.entries) {
                throw new Error('로어북 데이터를 찾을 수 없습니다.');
            }
            
            // 새 UID 생성
            const newUid = Date.now();
            
            const newEntry = {
                uid: newUid,
                key: keywordArray,
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
            
            // entries에 추가
            worldData.entries[newUid] = newEntry;
            
            // 저장
            await saveWorldInfo(worldName, worldData);
            toastr.success('서브 스토리가 생성되었습니다.');
            
        } else if (mode === 'timeline-main') {
            // 기존 타임라인에 이어붙이기
            const newContent = originalEntry.content + '\n\n' + content;
            await updateWorldInfoEntry(worldName, originalEntry.uid, { content: newContent });
            toastr.success('타임라인이 업데이트되었습니다.');
            
        } else {
            // 일반 항목 (전체 교체)
            await updateWorldInfoEntry(worldName, originalEntry.uid, { content: content });
            toastr.success('로어북이 업데이트되었습니다.');
        }
        
    } catch (error) {
        console.error('[LO] Save error:', error);
        toastr.error('저장 실패: ' + error.message);
    }
}

/**
 * World Info 항목 업데이트
 */
async function updateWorldInfoEntry(worldName, uid, updates) {
    // 기존 데이터 가져오기
    const worldData = await getWorldInfoData(worldName);
    if (!worldData || !worldData.entries) {
        throw new Error('로어북 데이터를 찾을 수 없습니다.');
    }
    
    // 해당 항목 찾기
    let targetEntry = null;
    
    for (const [key, entry] of Object.entries(worldData.entries)) {
        if (String(entry.uid) === String(uid)) {
            targetEntry = entry;
            break;
        }
    }
    
    if (!targetEntry) {
        throw new Error('항목을 찾을 수 없습니다.');
    }
    
    // 업데이트 적용
    Object.assign(targetEntry, updates);
    
    // saveWorldInfo로 저장
    await saveWorldInfo(worldName, worldData);
    console.log('[LO] Saved world info:', worldName);
}

/**
 * 슬립 함수
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 초기화
 */
jQuery(async () => {
    console.log('[Lorebook Organizer] Loading...');
    
    loadSettings();
    createSettingsUI();
    
    setTimeout(() => {
        addMenuButtons();
    }, 1000);
    
    console.log('[Lorebook Organizer] Loaded!');
});
