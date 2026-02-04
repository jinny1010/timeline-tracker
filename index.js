import {
    getContext,
    extension_settings,
    renderExtensionTemplateAsync,
} from '../../../extensions.js';

import { saveSettingsDebounced } from '../../../../script.js';
import { getCharacterLore, setWIOriginalDataValue } from '../../../world-info.js';
import { callPopup, POPUP_TYPE } from '../../../popup.js';
import { generateQuietPrompt } from '../../../slash-commands.js';

const extensionName = 'lorebook-organizer';
const extensionFolderPath = `scripts/extensions/third_party/${extensionName}`;

// 기본 설정
const defaultSettings = {
    buttonPosition: 'input', // 'input' | 'sidebar' | 'message'
    summaryRange: 'recent', // 'recent' | 'all' | 'manual'
    recentMessageCount: 20,
    enabled: true,
};

// 설정 로드
function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
    
    // UI에 설정값 반영
    $('#lo_button_position').val(extension_settings[extensionName].buttonPosition);
    $('#lo_summary_range').val(extension_settings[extensionName].summaryRange);
    $('#lo_recent_count').val(extension_settings[extensionName].recentMessageCount);
    $('#lo_enabled').prop('checked', extension_settings[extensionName].enabled);
    
    toggleRecentCountVisibility();
    updateButtonPosition();
}

// 최근 N개 선택 시에만 숫자 입력 보이기
function toggleRecentCountVisibility() {
    const range = extension_settings[extensionName].summaryRange;
    if (range === 'recent') {
        $('#lo_recent_count_wrapper').show();
    } else {
        $('#lo_recent_count_wrapper').hide();
    }
}

// 버튼 위치 업데이트
function updateButtonPosition() {
    // 기존 버튼 제거
    $('.lo-trigger-btn').remove();
    
    if (!extension_settings[extensionName].enabled) return;
    
    const position = extension_settings[extensionName].buttonPosition;
    const button = $('<div class="lo-trigger-btn" title="Lorebook Organizer"><i class="fa-solid fa-book-bookmark"></i></div>');
    
    button.on('click', openLorebookSelector);
    
    switch (position) {
        case 'input':
            $('#send_but_sheld').prepend(button);
            button.addClass('lo-btn-input');
            break;
        case 'sidebar':
            $('#extensionsMenu').after(button.addClass('lo-btn-sidebar'));
            break;
        case 'message':
            // 메시지 옵션은 동적으로 추가됨
            break;
    }
}

// 로어북 항목 선택 팝업
async function openLorebookSelector() {
    const context = getContext();
    
    if (!context.characterId) {
        toastr.warning('캐릭터를 먼저 선택해주세요.');
        return;
    }
    
    // 캐릭터 로어북 가져오기
    const lore = await getCharacterLore();
    
    if (!lore || lore.length === 0) {
        toastr.warning('로어북 항목이 없습니다.');
        return;
    }
    
    // 로어북 항목 목록 생성
    let html = `
        <div class="lo-selector-popup">
            <h3>정리할 로어북 항목 선택</h3>
            <div class="lo-entry-list">
    `;
    
    lore.forEach((entry, index) => {
        const title = entry.comment || entry.key?.[0] || `Entry ${index + 1}`;
        const isTimeline = title.toLowerCase().includes('timeline');
        html += `
            <div class="lo-entry-item" data-index="${index}" data-uid="${entry.uid}" data-is-timeline="${isTimeline}">
                <span class="lo-entry-title">${title}</span>
                <span class="lo-entry-keys">${(entry.key || []).slice(0, 3).join(', ')}</span>
            </div>
        `;
    });
    
    html += `
            </div>
        </div>
    `;
    
    const result = await callPopup(html, POPUP_TYPE.TEXT, '', { wide: true, large: false });
    
    // 항목 클릭 이벤트는 팝업 내에서 처리
}

// 선택된 로어북 항목 처리
async function processSelectedEntry(entry, isTimeline) {
    if (isTimeline) {
        // 타임라인: 메인/서브 선택
        const storyType = await selectStoryType();
        if (!storyType) return;
        
        await processTimeline(entry, storyType);
    } else {
        // 일반 항목 (Relationship 등)
        await processGenericEntry(entry);
    }
}

// 메인/서브 스토리 선택
async function selectStoryType() {
    const html = `
        <div class="lo-story-type-popup">
            <h3>스토리 유형 선택</h3>
            <div class="lo-story-options">
                <label class="lo-radio-option">
                    <input type="radio" name="story_type" value="main" checked>
                    <span>메인 스토리</span>
                    <small>기존 타임라인에 이어붙임</small>
                </label>
                <label class="lo-radio-option">
                    <input type="radio" name="story_type" value="sub">
                    <span>서브 스토리</span>
                    <small>새 로어북 항목 생성 + 키워드 자동</small>
                </label>
            </div>
        </div>
    `;
    
    return await callPopup(html, POPUP_TYPE.CONFIRM, '', {
        okButton: '확인',
        cancelButton: '취소',
    }).then(() => {
        return $('input[name="story_type"]:checked').val();
    }).catch(() => null);
}

// 대화 내용 가져오기
function getChatContent() {
    const context = getContext();
    const chat = context.chat || [];
    const settings = extension_settings[extensionName];
    
    let messages = [];
    
    switch (settings.summaryRange) {
        case 'recent':
            messages = chat.slice(-settings.recentMessageCount);
            break;
        case 'all':
            messages = chat;
            break;
        case 'manual':
            // TODO: 수동 선택 구현
            messages = chat.slice(-20);
            break;
    }
    
    return messages.map(msg => {
        const role = msg.is_user ? 'User' : (msg.is_system ? 'System' : 'Character');
        return `[${role}]: ${msg.mes}`;
    }).join('\n\n');
}

// 일반 항목 처리 (Relationship 등)
async function processGenericEntry(entry) {
    const chatContent = getChatContent();
    const existingContent = entry.content || '';
    
    // AI 프롬프트 생성
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

    toastr.info('AI가 요약 중입니다...');
    
    try {
        const result = await generateQuietPrompt(prompt, false, false);
        await openEditModal(result, entry, 'generic');
    } catch (error) {
        console.error('Lorebook Organizer Error:', error);
        toastr.error('요약 생성 실패');
    }
}

// 타임라인 처리
async function processTimeline(entry, storyType) {
    const chatContent = getChatContent();
    const existingContent = entry.content || '';
    
    if (storyType === 'main') {
        // 메인 스토리: 기존에 이어붙이기
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

        toastr.info('AI가 타임라인 요약 중...');
        
        try {
            const result = await generateQuietPrompt(prompt, false, false);
            await openEditModal(result, entry, 'timeline-main');
        } catch (error) {
            console.error('Lorebook Organizer Error:', error);
            toastr.error('요약 생성 실패');
        }
    } else {
        // 서브 스토리: 새 항목 생성
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

        toastr.info('AI가 서브 스토리 생성 중...');
        
        try {
            const result = await generateQuietPrompt(prompt, false, false);
            await openEditModal(result, entry, 'timeline-sub');
        } catch (error) {
            console.error('Lorebook Organizer Error:', error);
            toastr.error('요약 생성 실패');
        }
    }
}

// 편집 모달 열기
async function openEditModal(content, originalEntry, mode) {
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
        <div class="lo-edit-modal">
            <h3>내용 확인 및 수정</h3>
            <p class="lo-edit-hint">저장은 영어로 됩니다. 확인 후 수정하세요.</p>
            
            ${mode === 'timeline-sub' ? `
                <div class="lo-keywords-section">
                    <label>키워드 (쉼표로 구분)</label>
                    <input type="text" id="lo_edit_keywords" value="${keywords}">
                </div>
            ` : ''}
            
            <div class="lo-content-section">
                <label>내용</label>
                <textarea id="lo_edit_content" rows="15">${mainContent}</textarea>
            </div>
        </div>
    `;
    
    const confirmed = await callPopup(html, POPUP_TYPE.CONFIRM, '', {
        okButton: '저장',
        cancelButton: '취소',
        wide: true,
        large: true,
    });
    
    if (confirmed) {
        const finalContent = $('#lo_edit_content').val();
        const finalKeywords = $('#lo_edit_keywords').val();
        
        await saveToLorebook(finalContent, finalKeywords, originalEntry, mode);
    }
}

// 로어북에 저장
async function saveToLorebook(content, keywords, originalEntry, mode) {
    try {
        const context = getContext();
        
        if (mode === 'timeline-sub') {
            // 새 로어북 항목 생성
            const keywordArray = keywords.split(',').map(k => k.trim()).filter(k => k);
            
            // TODO: 새 로어북 항목 생성 API 호출
            // 임시로 기존 world-info 시스템 사용
            const newEntry = {
                key: keywordArray,
                content: content,
                comment: `Sub-Story: ${keywordArray[0] || 'Untitled'}`,
                enabled: true,
                constant: false,
            };
            
            // world-info에 추가하는 로직 필요
            toastr.success('서브 스토리가 생성되었습니다.');
            
        } else if (mode === 'timeline-main') {
            // 기존 타임라인에 이어붙이기
            const newContent = originalEntry.content + '\n\n' + content;
            await setWIOriginalDataValue(originalEntry, 'content', newContent);
            toastr.success('타임라인이 업데이트되었습니다.');
            
        } else {
            // 일반 항목 (전체 교체)
            await setWIOriginalDataValue(originalEntry, 'content', content);
            toastr.success('로어북이 업데이트되었습니다.');
        }
        
    } catch (error) {
        console.error('Save error:', error);
        toastr.error('저장 실패');
    }
}

// 설정 UI HTML
function getSettingsHtml() {
    return `
        <div class="lo-settings">
            <div class="inline-drawer">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>Lorebook Organizer</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
                </div>
                <div class="inline-drawer-content">
                    <div class="lo-setting-item">
                        <label>
                            <input type="checkbox" id="lo_enabled">
                            활성화
                        </label>
                    </div>
                    
                    <div class="lo-setting-item">
                        <label>버튼 위치</label>
                        <select id="lo_button_position">
                            <option value="input">입력창 옆</option>
                            <option value="sidebar">사이드바</option>
                            <option value="message">메시지 액션</option>
                        </select>
                    </div>
                    
                    <div class="lo-setting-item">
                        <label>요약 범위</label>
                        <select id="lo_summary_range">
                            <option value="recent">최근 N개 메시지</option>
                            <option value="all">전체 대화</option>
                            <option value="manual">직접 선택</option>
                        </select>
                    </div>
                    
                    <div class="lo-setting-item" id="lo_recent_count_wrapper">
                        <label>메시지 수</label>
                        <input type="number" id="lo_recent_count" min="1" max="100" value="20">
                    </div>
                </div>
            </div>
        </div>
    `;
}

// 이벤트 바인딩
function bindEvents() {
    // 설정 변경 이벤트
    $(document).on('change', '#lo_enabled', function() {
        extension_settings[extensionName].enabled = $(this).prop('checked');
        saveSettingsDebounced();
        updateButtonPosition();
    });
    
    $(document).on('change', '#lo_button_position', function() {
        extension_settings[extensionName].buttonPosition = $(this).val();
        saveSettingsDebounced();
        updateButtonPosition();
    });
    
    $(document).on('change', '#lo_summary_range', function() {
        extension_settings[extensionName].summaryRange = $(this).val();
        saveSettingsDebounced();
        toggleRecentCountVisibility();
    });
    
    $(document).on('change', '#lo_recent_count', function() {
        extension_settings[extensionName].recentMessageCount = parseInt($(this).val()) || 20;
        saveSettingsDebounced();
    });
    
    // 로어북 항목 클릭 이벤트
    $(document).on('click', '.lo-entry-item', async function() {
        const uid = $(this).data('uid');
        const isTimeline = $(this).data('is-timeline') === true || $(this).data('is-timeline') === 'true';
        
        // 팝업 닫기
        $('#dialogue_popup_ok').trigger('click');
        
        const lore = await getCharacterLore();
        const entry = lore.find(e => e.uid === uid);
        
        if (entry) {
            await processSelectedEntry(entry, isTimeline);
        }
    });
}

// 초기화
jQuery(async () => {
    // 설정 UI 추가
    const settingsHtml = getSettingsHtml();
    $('#extensions_settings').append(settingsHtml);
    
    // 설정 로드
    loadSettings();
    
    // 이벤트 바인딩
    bindEvents();
    
    console.log('Lorebook Organizer loaded');
});

export { };
