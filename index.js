// Lorebook Organizer Extension for SillyTavern
// 채팅 기반 조용한 요약 → 로어북 저장

import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { world_names, loadWorldInfo, saveWorldInfo } from '../../../world-info.js';
import { eventSource, event_types } from '../../../../script.js';

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
let pendingEntry = null;
let pendingMode = null;
let pendingWorldName = null;

// ========== 프롬프트 템플릿 ==========

const PROMPTS = {
    relationship: (existingContent, charName, userName) => `(OOC: 로어북의 #relationship 참고하여 ${charName}이 기억할 것들이 추가로 생겼다면 그것도 추가하거나 업데이트해줘.
바뀌지 않았다면 변화없음 이라고 적어줘
추가하거나 업데이트 된 부분만 적어줘. 호칭의 변화도 있으면 반드시 수정.
그가 약속한 것, 그의 의외의 행동, 그가 미래에 해야 할 것은 되도록 포함해.
${charName}이 알게 된 ${userName}에 관한 것도 추가된 게 있으면 추가해줘 (습관, 귀여운 행동, 사랑해! 이런 거.)
요약하면서 중요한 대사 같은 것은 자연스럽게 어감만 살려 추가해서 같이 적어줘 (고백, 약속 같은 거)
영어로 전체를 쓴 뒤, 한국어로 번역한 것도 써줘.

기존 로어북 양식:
${existingContent.substring(0, 2000)}

위 양식을 참고해서 같은 스타일로 작성해줘.)`,

    timelineMain: (existingContent, charName, userName) => `(OOC: 이전 이야기의 타임라인을 참고하여 지금까지의 이야기를 타임라인에 추가해 줘. 날짜를 작성하는 것을 잊지 마. 이전 타임라인의 양식을 따라.
NSFW 요소가 있다면, 어떻게 뭘 했는지 조금 더 추가해서 요약해.
요약하면서 중요한 대사 같은 것은 자연스럽게 어감만 살려 추가해서 같이 적어줘 (고백, 약속 같은 거)
영어로 전체를 쓴 뒤, 한국어로 번역한 것도 써줘.

기존 타임라인 양식:
${existingContent.substring(0, 2000)}

위 양식을 참고해서 같은 스타일로 작성해줘.)`,

    timelineSub: (existingContent, charName, userName) => `(OOC: 지금까지의 대화를 바탕으로 새로운 서브 스토리 항목을 만들어줘.
첫 줄에 KEYWORDS: 키워드1, 키워드2, 키워드3 (3-5개의 트리거 키워드)
그 다음 줄부터 이 특정 이야기/이벤트의 상세 요약을 작성해.
배경, 무슨 일이 있었는지, 감정적 순간들, 캐릭터 상호작용을 포함해.
영어로 전체를 쓴 뒤, 한국어로 번역한 것도 써줘.

참고할 메인 타임라인 양식:
${existingContent.substring(0, 1500)})`
};

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

// ========== SillyTavern 팝업 (POPUP_TYPE 사용) ==========

async function showLoPopup(content, type = 'TEXT', options = {}) {
    const ctx = getContext();
    
    // POPUP_TYPE enum 값 사용
    const POPUP_TYPE = {
        TEXT: 1,
        CONFIRM: 2,
        INPUT: 3,
    };
    
    const popupType = POPUP_TYPE[type] || POPUP_TYPE.TEXT;
    
    if (ctx.callGenericPopup) {
        return await ctx.callGenericPopup(content, popupType, '', options);
    } else if (ctx.callPopup) {
        return await ctx.callPopup(content, popupType, '', options);
    }
    
    throw new Error('Popup not available');
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
        const isRelationship = title.toLowerCase().includes('relationship');
        const keys = Array.isArray(entry.key) ? entry.key.slice(0, 3).join(', ') : '';
        
        const icon = isTimeline ? '📅' : isRelationship ? '💕' : '📝';
        
        entriesHtml += `
            <div class="lo-entry-item" data-index="${idx}" data-timeline="${isTimeline}"
                 style="padding:12px; margin:5px 0; background:var(--SmartThemeBlurTintColor); border-radius:8px; cursor:pointer; border:1px solid var(--SmartThemeBorderColor);">
                <div style="font-weight:600;">${icon} ${escapeHtml(title)}</div>
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
        const isTimeline = $(this).data('timeline') === true || $(this).data('timeline') === 'true';
        const entry = currentEntries[idx];
        
        if (!entry) return;
        
        // 팝업 닫기
        $('.popup-button-ok, #dialogue_popup_ok, .menu_button.result-control').first().click();
        $(document).off('click.lo');
        
        await sleep(300);
        await processEntry(entry, isTimeline, currentLoreBook);
    });
    
    try {
        await showLoPopup(popupHtml, 'TEXT', { wide: true, okButton: '닫기' });
    } catch(e) {
        console.error('[LO] Popup error:', e);
    }
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
            
            pendingMode = storyType === 'main' ? 'timeline-main' : 'timeline-sub';
        } else {
            pendingMode = 'relationship';
        }
        
        pendingEntry = entry;
        pendingWorldName = worldName;
        
        // 프롬프트 전송
        await sendSummaryRequest(entry, pendingMode);
        
    } catch (error) {
        console.error('[LO] Error:', error);
        toastr.error('오류: ' + error.message);
        isProcessing = false;
    }
}

async function selectStoryType() {
    return new Promise(async (resolve) => {
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
        
        try {
            const result = await showLoPopup(html, 'CONFIRM', { okButton: '확인', cancelButton: '취소' });
            if (result) {
                resolve($('input[name="lo_story"]:checked').val());
            } else {
                resolve(null);
            }
        } catch(e) {
            resolve(null);
        }
    });
}

// ========== 채팅 기반 요약 ==========

async function sendSummaryRequest(entry, mode) {
    const ctx = getContext();
    const charName = ctx.characters[ctx.characterId]?.name || 'Character';
    const userName = ctx.name1 || 'User';
    const existingContent = entry.content || '';
    
    let prompt;
    if (mode === 'relationship') {
        prompt = PROMPTS.relationship(existingContent, charName, userName);
    } else if (mode === 'timeline-main') {
        prompt = PROMPTS.timelineMain(existingContent, charName, userName);
    } else {
        prompt = PROMPTS.timelineSub(existingContent, charName, userName);
    }
    
    toastr.info('AI에게 요약 요청 중... 잠시 기다려주세요.');
    
    try {
        // 방법 1: /trigger quiet 사용 (채팅에 안 보임)
        if (ctx.executeSlashCommandsWithOptions) {
            const result = await ctx.executeSlashCommandsWithOptions(`/trigger await=true ${prompt}`);
            if (result?.pipe) {
                await handleAIResponse(result.pipe);
                return;
            }
        }
        
        // 방법 2: generateQuietPrompt 사용
        if (ctx.generateQuietPrompt) {
            const result = await ctx.generateQuietPrompt(prompt);
            if (result) {
                await handleAIResponse(result);
                return;
            }
        }
        
        // 방법 3: Generate quiet 모드
        if (ctx.Generate) {
            const result = await ctx.Generate('quiet', { quiet_prompt: prompt, skipWIAN: true, force_name2: true });
            if (result) {
                await handleAIResponse(result);
                return;
            }
        }
        
        // 방법 4: 슬래시 커맨드
        if (ctx.executeSlashCommands) {
            const result = await ctx.executeSlashCommands(`/gen lock=on ${prompt}`);
            if (result?.pipe) {
                await handleAIResponse(result.pipe);
                return;
            }
        }
        
        throw new Error('생성 방법을 찾을 수 없습니다.');
        
    } catch (error) {
        console.error('[LO] Generation error:', error);
        toastr.error('요약 생성 실패: ' + error.message);
        isProcessing = false;
    }
}

// ========== AI 응답 처리 ==========

async function handleAIResponse(response) {
    if (!response || !pendingEntry) {
        toastr.error('응답이 없습니다.');
        isProcessing = false;
        return;
    }
    
    console.log('[LO] AI Response received:', response.substring(0, 200) + '...');
    
    // 영어/한글 분리 시도
    let englishContent = response;
    let koreanContent = '';
    
    // 한국어 번역 부분 찾기
    const koreanMarkers = ['한국어', '번역:', 'Korean:', '한글:', '---'];
    for (const marker of koreanMarkers) {
        const idx = response.indexOf(marker);
        if (idx > 0 && idx < response.length - 100) {
            englishContent = response.substring(0, idx).trim();
            koreanContent = response.substring(idx).trim();
            break;
        }
    }
    
    // 서브스토리면 키워드 파싱
    let keywords = '';
    if (pendingMode === 'timeline-sub') {
        const lines = englishContent.split('\n');
        if (lines[0]?.toUpperCase().includes('KEYWORDS:')) {
            keywords = lines[0].replace(/^KEYWORDS:\s*/i, '').trim();
            englishContent = lines.slice(1).join('\n').trim();
        }
    }
    
    await showEditModal(englishContent, koreanContent, keywords, pendingEntry, pendingMode, pendingWorldName);
}

// ========== 편집 모달 ==========

async function showEditModal(englishContent, koreanContent, keywords, originalEntry, mode, worldName) {
    const keywordHtml = mode === 'timeline-sub' ? `
        <div style="margin-bottom:15px;">
            <label style="font-weight:600;">🏷️ 키워드 (쉼표 구분)</label>
            <input type="text" id="lo_keywords" value="${escapeHtml(keywords)}" 
                   style="width:100%; padding:8px; margin-top:5px; border-radius:5px; border:1px solid var(--SmartThemeBorderColor); background:var(--SmartThemeBlurTintColor); color:var(--SmartThemeBodyColor);">
        </div>
    ` : '';
    
    const modeLabel = mode === 'relationship' ? '관계 정보 업데이트' : 
                      mode === 'timeline-main' ? '타임라인 추가' : '서브 스토리 생성';
    
    const hasKorean = koreanContent && koreanContent.length > 50;
    
    const html = `
        <div style="display:flex; flex-direction:column; gap:10px; min-width:${hasKorean ? '800px' : '500px'}; max-width:900px;">
            <h3 style="margin:0; text-align:center;">✏️ ${modeLabel} - 확인 및 수정</h3>
            
            <div style="padding:10px; background:rgba(255,193,7,0.1); border-radius:5px; border-left:3px solid #ffc107;">
                ⚠️ <strong>저장 전 확인하세요!</strong> 왼쪽 영어 내용이 로어북에 저장됩니다.
            </div>
            
            ${keywordHtml}
            
            <div style="display:flex; gap:15px;">
                <div style="flex:1;">
                    <label style="font-weight:600; display:block; margin-bottom:5px;">🇺🇸 English (저장될 내용)</label>
                    <textarea id="lo_english" rows="20" 
                              style="width:100%; padding:10px; border-radius:5px; border:1px solid var(--SmartThemeBorderColor); background:var(--SmartThemeBlurTintColor); color:var(--SmartThemeBodyColor); resize:vertical; font-size:12px; font-family:monospace;">${escapeHtml(englishContent)}</textarea>
                </div>
                ${hasKorean ? `
                <div style="flex:1;">
                    <label style="font-weight:600; display:block; margin-bottom:5px;">🇰🇷 한글 (참고용)</label>
                    <textarea id="lo_korean" rows="20" readonly
                              style="width:100%; padding:10px; border-radius:5px; border:1px solid var(--SmartThemeBorderColor); background:var(--SmartThemeBlurTintColor); color:var(--SmartThemeBodyColor); resize:vertical; font-size:12px; opacity:0.85;">${escapeHtml(koreanContent)}</textarea>
                </div>
                ` : ''}
            </div>
        </div>
    `;
    
    try {
        const confirmed = await showLoPopup(html, 'CONFIRM', { 
            okButton: '💾 로어북에 저장', 
            cancelButton: '취소', 
            wide: true,
            large: true,
            allowVerticalScrolling: true
        });
        
        if (confirmed) {
            const finalContent = $('#lo_english').val();
            const finalKeywords = $('#lo_keywords').val() || '';
            
            await saveToLorebook(finalContent, finalKeywords, originalEntry, mode, worldName);
        }
    } catch(e) {
        console.error('[LO] Modal error:', e);
    }
    
    // 정리
    pendingEntry = null;
    pendingMode = null;
    pendingWorldName = null;
    isProcessing = false;
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
            toastr.success(`✅ 서브 스토리 생성됨: ${keywordArray.join(', ')}`);
            
        } else if (mode === 'timeline-main') {
            // 기존 타임라인에 추가
            const entry = findEntryByUid(worldData.entries, originalEntry.uid);
            if (entry) {
                entry.content = (entry.content || '') + '\n\n---\n\n' + content;
                await saveWorldInfo(worldName, worldData);
                toastr.success('✅ 타임라인 업데이트됨');
            }
            
        } else {
            // relationship 등 일반 항목 교체
            const entry = findEntryByUid(worldData.entries, originalEntry.uid);
            if (entry) {
                entry.content = content;
                await saveWorldInfo(worldName, worldData);
                toastr.success('✅ 로어북 업데이트됨');
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
