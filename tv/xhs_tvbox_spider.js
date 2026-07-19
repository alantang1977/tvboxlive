// xhs_tvbox_compat.js - 最大兼容性版本
const host = 'https://www.xiaohongshu.com';
const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    'Referer': 'https://www.xiaohongshu.com/'
};

// 安全获取嵌套对象属性（替代 ?. 可选链）
function safeGet(obj, path, defaultValue) {
    if (!obj || typeof obj !== 'object') return defaultValue;
    var parts = path.split('.');
    var current = obj;
    for (var i = 0; i < parts.length; i++) {
        if (current === null || current === undefined) return defaultValue;
        current = current[parts[i]];
    }
    return current !== undefined ? current : defaultValue;
}

// 提取 window.__INITIAL_STATE__
function extractState(html) {
    if (!html || html.indexOf('window.__INITIAL_STATE__') === -1) return null;
    
    var match = html.match(/<script[^>]*>window\.__INITIAL_STATE__\s*=\s*({.+?})<\/script>/s);
    if (!match) {
        match = html.match(/window\.__INITIAL_STATE__\s*=\s*({.+?});?\s*<\/script>/s);
    }
    if (!match) return null;
    
    var jsonStr = match[1];
    // 处理JS特殊值
    jsonStr = jsonStr.replace(/undefined/g, 'null');
    jsonStr = jsonStr.replace(/NaN/g, 'null');
    
    try {
        return JSON.parse(jsonStr);
    } catch(e) {
        return null;
    }
}

// 获取笔记视频流
function getNoteVideo(noteId, xsecToken) {
    var noteUrl = host + '/explore/' + noteId;
    if (xsecToken) {
        noteUrl += '?xsec_token=' + encodeURIComponent(xsecToken) + '&xsec_source=pc_stab';
    }
    
    var r = request(noteUrl, { headers: headers });
    if (!r || !r.content) return { streams: [], bestStream: null };
    
    var state = extractState(r.content);
    if (!state) return { streams: [], bestStream: null };
    
    var streams = [];
    var noteData = safeGet(state, 'note.noteDetailMap.' + noteId + '.note', {});
    var videoData = noteData.video || {};
    
    // 从 media 提取
    var media = videoData.media || {};
    var streamOld = media.stream || {};
    var codecs = ['h264', 'h265', 'av1', 'h266'];
    
    for (var i = 0; i < codecs.length; i++) {
        var codec = codecs[i];
        var codecStreams = streamOld[codec];
        if (codecStreams && Array.isArray(codecStreams)) {
            for (var j = 0; j < codecStreams.length; j++) {
                var s = codecStreams[j];
                var url = s.masterUrl || (s.backupUrls && s.backupUrls[0]) || '';
                if (url) {
                    streams.push({
                        source: 'media',
                        codec: codec,
                        url: url,
                        width: s.width || 0,
                        height: s.height || 0,
                        quality: s.qualityType || ''
                    });
                }
            }
        }
    }
    
    // 从 mediaV2 提取
    var mediaV2Str = videoData.mediaV2 || '';
    if (typeof mediaV2Str === 'string' && mediaV2Str.length > 0) {
        try {
            var mediaV2 = JSON.parse(mediaV2Str);
            if (mediaV2 && mediaV2.video) {
                var videoV2 = mediaV2.video;
                var streamV2 = videoV2.stream || {};
                
                for (var i = 0; i < codecs.length; i++) {
                    var codec = codecs[i];
                    var codecStreams = streamV2[codec];
                    if (codecStreams && Array.isArray(codecStreams)) {
                        for (var j = 0; j < codecStreams.length; j++) {
                            var s = codecStreams[j];
                            var url = s.master_url || (s.backup_urls && s.backup_urls[0]) || '';
                            if (url) {
                                streams.push({
                                    source: 'mediaV2',
                                    codec: codec,
                                    url: url,
                                    width: s.width || 0,
                                    height: s.height || 0,
                                    quality: s.quality_type || ''
                                });
                            }
                        }
                    }
                }
            }
        } catch(e) {}
    }
    
    // 去重并排序
    var seen = {};
    var unique = [];
    for (var i = 0; i < streams.length; i++) {
        var urlBase = streams[i].url.split('?')[0];
        if (!seen[urlBase]) {
            seen[urlBase] = true;
            unique.push(streams[i]);
        }
    }
    
    unique.sort(function(a, b) {
        return (b.width * b.height) - (a.width * a.height);
    });
    
    return {
        streams: unique,
        bestStream: unique.length > 0 ? unique[0].url : null
    };
}

// ============ TVBOX 接口 ============

function init(cfg) {
    return '';
}

function home(filter) {
    var result = {
        class: [
            { type_id: 'all', type_name: '全部比赛' }
        ]
    };
    return JSON.stringify(result);
}

function homeVod() {
    var url = host + '/worldcup26';
    var r = request(url, { headers: headers });
    
    if (!r || !r.content) {
        return JSON.stringify({ list: [] });
    }
    
    var state = extractState(r.content);
    if (!state) {
        return JSON.stringify({ list: [] });
    }
    
    var matches = safeGet(state, 'worldCupMatch.matches', []);
    var videos = [];
    
    for (var i = 0; i < matches.length; i++) {
        var match = matches[i];
        videos.push({
            vod_id: match.matchId || '',
            vod_name: (match.homeTeamName || '') + ' vs ' + (match.awayTeamName || ''),
            vod_pic: match.homeTeamLogo || '',
            vod_remarks: (match.statusDesc || '') + ' | ' + (match.homeScore || '0') + '-' + (match.awayScore || '0'),
            vod_content: (match.roundStage || '') + ' ' + (match.matchTime || '')
        });
    }
    
    return JSON.stringify({ list: videos });
}

function category(tid, pg, filter, extend) {
    return homeVod();
}

function detail(id) {
    var matchUrl = host + '/worldcup26/match/' + id + '?wcup_source=web_main_venue_page';
    var r = request(matchUrl, { headers: headers });
    
    if (!r || !r.content) {
        return JSON.stringify({ list: [] });
    }
    
    var state = extractState(r.content);
    if (!state) {
        return JSON.stringify({ list: [] });
    }
    
    var matchBase = safeGet(state, 'worldCupMatch.matchBase', {});
    var matchInfo = safeGet(state, 'worldCupMatch.matchInfo', {});
    
    var homeTeam = matchBase.homeTeamName || '';
    var awayTeam = matchBase.awayTeamName || '';
    var homeScore = matchBase.homeScore || '0';
    var awayScore = matchBase.awayScore || '0';
    
    // 收集视频
    var videos = [];
    
    // 官方回放
    var liveInfo = matchBase.liveInfo || {};
    if (liveInfo.replayNoteId) {
        var videoData = getNoteVideo(liveInfo.replayNoteId, liveInfo.xsecToken || '');
        if (videoData.bestStream) {
            videos.push('官方全场回放$' + videoData.bestStream);
        }
    }
    
    // reportList
    var reportList = matchInfo.reportList || [];
    for (var i = 0; i < reportList.length; i++) {
        var item = reportList[i];
        if (item.noteId && item.type === 'video') {
            var videoData = getNoteVideo(item.noteId, item.xsecToken || '');
            if (videoData.bestStream) {
                videos.push((item.title || '战报' + (i + 1)) + '$' + videoData.bestStream);
            }
        }
    }
    
    // highList
    var highList = matchInfo.highList || [];
    for (var i = 0; i < highList.length; i++) {
        var item = highList[i];
        if (item.noteId && item.type === 'video') {
            var videoData = getNoteVideo(item.noteId, item.xsecToken || '');
            if (videoData.bestStream) {
                videos.push((item.title || '高光' + (i + 1)) + '$' + videoData.bestStream);
            }
        }
    }
    
    if (videos.length === 0) {
        videos.push('暂无视频$https://www.baidu.com');
    }
    
    var result = {
        list: [{
            vod_id: id,
            vod_name: homeTeam + ' vs ' + awayTeam,
            vod_pic: matchBase.homeTeamLogo || '',
            vod_remarks: matchBase.statusDesc || '',
            vod_content: homeTeam + ' ' + homeScore + ' - ' + awayScore + ' ' + awayTeam,
            vod_play_from: '小红书',
            vod_play_url: videos.join('#')
        }]
    };
    
    return JSON.stringify(result);
}

function search(wd, quick, pg) {
    return JSON.stringify({ page: pg || 1, list: [] });
}

function play(flag, id, flags) {
    return JSON.stringify({
        parse: 0,
        url: id,
        header: {
            'User-Agent': headers['User-Agent'],
            'Referer': 'https://www.xiaohongshu.com/',
            'Origin': 'https://www.xiaohongshu.com'
        }
    });
}

// 导出（兼容两种模式）
var __jsEvalReturn = function() {
    return {
        init: init,
        home: home,
        homeVod: homeVod,
        category: category,
        detail: detail,
        search: search,
        play: play
    };
};

// 尝试 export default（新版 TVBOX）
try {
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { init: init, home: home, homeVod: homeVod, category: category, detail: detail, search: search, play: play };
    }
} catch(e) {}

// 旧版 TVBOX 使用 __jsEvalReturn
if (typeof window !== 'undefined') {
    window.__jsEvalReturn = __jsEvalReturn;
}
