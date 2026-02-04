import { saveSettingsDebounced } from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';

const extensionName = 'style-cloner';
const getContext = () => SillyTavern.getContext();

// 기본 설정
const defaultSettings = {
    apiKey: '',
    model: 'gemini-2.0-flash-exp-image-generation',
    referenceImageBase64: '',
    referenceImageMime: '',
    styleStrength: 'medium',
    lastPrompt: '',
};

/**
 * 설정 로드
 */
function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    
    for (const [key, value] of Object.entries(defaultSettings)) {
        if (extension_settings[extensionName][key] === undefined) {
            extension_settings[extensionName][key] = value;
        }
    }
}

function getSettings() {
    return extension_settings[extensionName];
}

/**
 * 이미지를 Base64로 변환
 */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            const base64 = result.split(',')[1];
            const mime = file.type;
            resolve({ base64, mime });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

/**
 * Gemini API로 스타일 복제 이미지 생성
 */
async function generateWithStyle(prompt) {
    const settings = getSettings();
    
    if (!settings.apiKey) {
        toastr.error('API 키를 입력해주세요!', 'Style Cloner');
        return null;
    }
    
    if (!settings.referenceImageBase64) {
        toastr.error('참조 이미지를 먼저 업로드해주세요!', 'Style Cloner');
        return null;
    }

    if (!prompt.trim()) {
        toastr.error('생성할 이미지 설명을 입력해주세요!', 'Style Cloner');
        return null;
    }

    // 스타일 강도에 따른 지시문
    const strengthInstructions = {
        low: '이 참조 이미지와 비슷한 분위기의 아트 스타일로 그려주세요.',
        medium: '이 참조 이미지의 아트 스타일, 색감, 선 굵기를 최대한 비슷하게 따라해서 그려주세요.',
        high: '이 참조 이미지의 아트 스타일, 채색 기법, 음영 처리, 선 굵기, 전체적인 분위기를 완벽하게 복제해서 그려주세요. 마치 같은 작가가 그린 것처럼 만들어주세요.'
    };

    const styleInstruction = strengthInstructions[settings.styleStrength] || strengthInstructions.medium;
    const fullPrompt = `${styleInstruction}\n\n그려야 할 내용: ${prompt}`;

    try {
        toastr.info('이미지 생성 중... 잠시만 기다려주세요.', 'Style Cloner');
        
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${settings.model}:generateContent?key=${settings.apiKey}`;
        
        const payload = {
            contents: [{
                parts: [
                    {
                        inline_data: {
                            mime_type: settings.referenceImageMime,
                            data: settings.referenceImageBase64
                        }
                    },
                    {
                        text: fullPrompt
                    }
                ]
            }],
            generationConfig: {
                responseModalities: ['image', 'text'],
            }
        };

        console.log('[Style Cloner] API 요청 전송:', settings.model);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error.message);
        }

        // 응답에서 이미지 추출
        const parts = data.candidates?.[0]?.content?.parts || [];
        
        for (const part of parts) {
            if (part.inline_data) {
                console.log('[Style Cloner] 이미지 생성 성공!');
                return {
                    base64: part.inline_data.data,
                    mime: part.inline_data.mime_type || 'image/png'
                };
            }
        }

        // 이미지 없으면 텍스트 응답 확인
        const textPart = parts.find(p => p.text);
        if (textPart) {
            console.log('[Style Cloner] 텍스트 응답:', textPart.text);
            toastr.warning(`모델 응답: ${textPart.text.substring(0, 150)}...`, 'Style Cloner', { timeOut: 8000 });
        }
        
        throw new Error('이미지가 생성되지 않았습니다. 다른 프롬프트나 모델을 시도해보세요.');

    } catch (error) {
        console.error('[Style Cloner] 에러:', error);
        toastr.error(`생성 실패: ${error.message}`, 'Style Cloner', { timeOut: 8000 });
        return null;
    }
}

/**
 * 생성된 이미지 표시
 */
function displayResult(imageData) {
    const imgSrc = `data:${imageData.mime};base64,${imageData.base64}`;
    
    const resultImg = document.getElementById('style_cloner_result_img');
    if (resultImg) {
        resultImg.src = imgSrc;
        resultImg.style.display = 'block';
    }

    const downloadBtn = document.getElementById('style_cloner_download');
    if (downloadBtn) {
        downloadBtn.href = imgSrc;
        downloadBtn.download = `style_cloner_${Date.now()}.png`;
        downloadBtn.style.display = 'inline-flex';
    }
    
    const resultPlaceholder = document.getElementById('style_cloner_result_placeholder');
    if (resultPlaceholder) {
        resultPlaceholder.style.display = 'none';
    }
}

/**
 * 설정 UI HTML 생성
 */
function createSettingsHtml() {
    const settings = getSettings();
    
    return `
    <div id="style_cloner_settings" class="style-cloner-container">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>🎨 Style Cloner - 그림체 복제</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                
                <!-- 안내 -->
                <div class="style-cloner-info">
                    <i class="fa-solid fa-info-circle"></i>
                    참조 이미지의 그림체를 학습하여 새로운 이미지를 생성합니다.
                    <br>Gemini API를 직접 호출하므로 별도의 API 키가 필요합니다.
                </div>

                <!-- API 키 입력 -->
                <div class="style-cloner-section">
                    <label class="style-cloner-label">
                        <i class="fa-solid fa-key"></i> Google AI Studio API 키
                    </label>
                    <div class="style-cloner-input-group">
                        <input type="password" id="style_cloner_api_key" class="text_pole" 
                               placeholder="API 키 입력..." value="${settings.apiKey || ''}">
                        <button id="style_cloner_toggle_key" class="menu_button" title="API 키 보기/숨기기">
                            <i class="fa-solid fa-eye"></i>
                        </button>
                    </div>
                    <small class="style-cloner-hint">
                        <a href="https://aistudio.google.com/app/apikey" target="_blank">Google AI Studio</a>에서 무료로 발급받을 수 있습니다.
                    </small>
                </div>

                <!-- 모델 선택 -->
                <div class="style-cloner-section">
                    <label class="style-cloner-label">
                        <i class="fa-solid fa-robot"></i> 모델 선택
                    </label>
                    <select id="style_cloner_model" class="text_pole">
                        <option value="gemini-2.0-flash-exp-image-generation" ${settings.model === 'gemini-2.0-flash-exp-image-generation' ? 'selected' : ''}>Gemini 2.0 Flash (실험적 이미지 생성)</option>
                        <option value="gemini-2.0-flash-preview-image-generation" ${settings.model === 'gemini-2.0-flash-preview-image-generation' ? 'selected' : ''}>Gemini 2.0 Flash Preview</option>
                        <option value="gemini-exp-1206" ${settings.model === 'gemini-exp-1206' ? 'selected' : ''}>Gemini Exp 1206</option>
                    </select>
                </div>

                <!-- 스타일 강도 -->
                <div class="style-cloner-section">
                    <label class="style-cloner-label">
                        <i class="fa-solid fa-sliders"></i> 스타일 복제 강도
                    </label>
                    <select id="style_cloner_strength" class="text_pole">
                        <option value="low" ${settings.styleStrength === 'low' ? 'selected' : ''}>약하게 - 비슷한 분위기만</option>
                        <option value="medium" ${settings.styleStrength === 'medium' ? 'selected' : ''}>보통 - 스타일, 색감 비슷하게</option>
                        <option value="high" ${settings.styleStrength === 'high' ? 'selected' : ''}>강하게 - 완벽히 복제</option>
                    </select>
                </div>

                <hr class="style-cloner-divider">

                <!-- 참조 이미지 업로드 -->
                <div class="style-cloner-section">
                    <label class="style-cloner-label">
                        <i class="fa-solid fa-palette"></i> 참조 이미지 (복제할 그림체)
                    </label>
                    <div class="style-cloner-upload-area" id="style_cloner_upload_area">
                        <input type="file" id="style_cloner_ref_upload" accept="image/*" style="display:none;">
                        <div id="style_cloner_upload_placeholder" class="${settings.referenceImageBase64 ? 'hidden' : ''}">
                            <i class="fa-solid fa-cloud-arrow-up"></i>
                            <span>클릭하거나 이미지를 드래그하세요</span>
                        </div>
                        <img id="style_cloner_ref_preview" 
                             src="${settings.referenceImageBase64 ? `data:${settings.referenceImageMime};base64,${settings.referenceImageBase64}` : ''}"
                             class="${settings.referenceImageBase64 ? '' : 'hidden'}">
                    </div>
                    <div class="style-cloner-upload-actions ${settings.referenceImageBase64 ? '' : 'hidden'}" id="style_cloner_upload_actions">
                        <button id="style_cloner_change_ref" class="menu_button">
                            <i class="fa-solid fa-arrows-rotate"></i> 변경
                        </button>
                        <button id="style_cloner_clear_ref" class="menu_button">
                            <i class="fa-solid fa-trash"></i> 삭제
                        </button>
                    </div>
                </div>

                <hr class="style-cloner-divider">

                <!-- 프롬프트 입력 -->
                <div class="style-cloner-section">
                    <label class="style-cloner-label">
                        <i class="fa-solid fa-pencil"></i> 생성할 이미지 설명
                    </label>
                    <textarea id="style_cloner_prompt" class="text_pole textarea_compact" 
                              rows="4" placeholder="예: 긴 검은 머리 소녀가 벚꽃 아래에서 웃고 있다">${settings.lastPrompt || ''}</textarea>
                </div>

                <!-- 생성 버튼 -->
                <button id="style_cloner_generate" class="menu_button style-cloner-generate-btn">
                    <i class="fa-solid fa-wand-magic-sparkles"></i> 이미지 생성
                </button>

                <!-- 결과 영역 -->
                <div class="style-cloner-section">
                    <label class="style-cloner-label">
                        <i class="fa-solid fa-image"></i> 생성 결과
                    </label>
                    <div class="style-cloner-result-area">
                        <div id="style_cloner_result_placeholder" class="style-cloner-result-placeholder">
                            <i class="fa-solid fa-image"></i>
                            <span>이미지가 여기에 표시됩니다</span>
                        </div>
                        <img id="style_cloner_result_img" style="display:none;">
                        <a id="style_cloner_download" class="menu_button style-cloner-download-btn" style="display:none;">
                            <i class="fa-solid fa-download"></i> 다운로드
                        </a>
                    </div>
                </div>

            </div>
        </div>
    </div>
    `;
}

/**
 * 이벤트 리스너 등록
 */
function setupEventListeners() {
    // API 키 입력
    $('#style_cloner_api_key').on('input', function() {
        getSettings().apiKey = $(this).val();
        saveSettingsDebounced();
    });

    // API 키 보기/숨기기
    $('#style_cloner_toggle_key').on('click', function() {
        const input = $('#style_cloner_api_key');
        const icon = $(this).find('i');
        if (input.attr('type') === 'password') {
            input.attr('type', 'text');
            icon.removeClass('fa-eye').addClass('fa-eye-slash');
        } else {
            input.attr('type', 'password');
            icon.removeClass('fa-eye-slash').addClass('fa-eye');
        }
    });

    // 모델 변경
    $('#style_cloner_model').on('change', function() {
        getSettings().model = $(this).val();
        saveSettingsDebounced();
    });

    // 스타일 강도 변경
    $('#style_cloner_strength').on('change', function() {
        getSettings().styleStrength = $(this).val();
        saveSettingsDebounced();
    });

    // 업로드 영역 클릭
    $('#style_cloner_upload_area').on('click', function(e) {
        if (e.target.id !== 'style_cloner_ref_preview') {
            $('#style_cloner_ref_upload').trigger('click');
        }
    });

    // 변경 버튼
    $('#style_cloner_change_ref').on('click', function() {
        $('#style_cloner_ref_upload').trigger('click');
    });

    // 드래그 앤 드롭
    $('#style_cloner_upload_area').on('dragover', function(e) {
        e.preventDefault();
        $(this).addClass('dragover');
    }).on('dragleave drop', function(e) {
        e.preventDefault();
        $(this).removeClass('dragover');
    }).on('drop', async function(e) {
        const file = e.originalEvent.dataTransfer?.files[0];
        if (file && file.type.startsWith('image/')) {
            await handleImageUpload(file);
        }
    });

    // 파일 선택
    $('#style_cloner_ref_upload').on('change', async function() {
        const file = this.files[0];
        if (file) {
            await handleImageUpload(file);
        }
    });

    // 참조 이미지 삭제
    $('#style_cloner_clear_ref').on('click', function() {
        const settings = getSettings();
        settings.referenceImageBase64 = '';
        settings.referenceImageMime = '';
        saveSettingsDebounced();

        $('#style_cloner_ref_preview').attr('src', '').addClass('hidden');
        $('#style_cloner_upload_placeholder').removeClass('hidden');
        $('#style_cloner_upload_actions').addClass('hidden');
        $('#style_cloner_ref_upload').val('');
        
        toastr.info('참조 이미지가 삭제되었습니다.', 'Style Cloner');
    });

    // 프롬프트 저장
    $('#style_cloner_prompt').on('input', function() {
        getSettings().lastPrompt = $(this).val();
        saveSettingsDebounced();
    });

    // 이미지 생성
    $('#style_cloner_generate').on('click', async function() {
        const prompt = $('#style_cloner_prompt').val().trim();
        
        const $btn = $(this);
        $btn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> 생성 중...');

        try {
            const result = await generateWithStyle(prompt);
            
            if (result) {
                displayResult(result);
                toastr.success('이미지 생성 완료!', 'Style Cloner');
            }
        } finally {
            $btn.prop('disabled', false).html('<i class="fa-solid fa-wand-magic-sparkles"></i> 이미지 생성');
        }
    });
}

/**
 * 이미지 업로드 처리
 */
async function handleImageUpload(file) {
    try {
        toastr.info('이미지 로딩 중...', 'Style Cloner');
        
        const { base64, mime } = await fileToBase64(file);
        const settings = getSettings();
        settings.referenceImageBase64 = base64;
        settings.referenceImageMime = mime;
        saveSettingsDebounced();

        $('#style_cloner_ref_preview').attr('src', `data:${mime};base64,${base64}`).removeClass('hidden');
        $('#style_cloner_upload_placeholder').addClass('hidden');
        $('#style_cloner_upload_actions').removeClass('hidden');
        
        toastr.success('참조 이미지가 저장되었습니다!', 'Style Cloner');
    } catch (error) {
        console.error('[Style Cloner] 이미지 로드 실패:', error);
        toastr.error('이미지 로드 실패', 'Style Cloner');
    }
}

/**
 * 초기화
 */
jQuery(async () => {
    loadSettings();
    
    // UI 추가
    const settingsHtml = createSettingsHtml();
    $('#extensions_settings').append(settingsHtml);
    
    // 이벤트 리스너
    setupEventListeners();
    
    console.log('[Style Cloner] v2.0.0 로드 완료!');
});
