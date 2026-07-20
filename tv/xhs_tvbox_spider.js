/**
 * 修正版 - 根据实际键名提取数据
 * 
 * 实际顶层键包含: "worldCup26", "worldCupMatchSchedule" 等
 * 而不是 "worldCupMatch"
 */

(function() {
    'use strict';

    console.clear();
    console.log('🚀 小红书世界杯数据提取测试 v3 (修正版)\n');

    const state = window.__INITIAL_STATE__;
    if (!state) {
        console.error('❌ window.__INITIAL_STATE__ 不存在');
        return;
    }

    console.log('=== 顶层键 ===');
    console.log(Object.keys(state));

    // 尝试找到包含比赛数据的键
    const possibleKeys = [
        'worldCup26',
        'worldCupMatchSchedule', 
        'worldCupHome',
        'worldCupFeedLayout'
    ];

    let targetKey = null;
    let targetData = null;

    for (const key of possibleKeys) {
        if (state[key]) {
            console.log(`\n✅ 找到键: ${key}`);
            console.log(`${key} 的键:`, Object.keys(state[key]));
            targetKey = key;
            targetData = state[key];

            // 检查是否包含 matches
            if (state[key].matches) {
                console.log(`✅ ${key}.matches 存在，比赛数:`, state[key].matches.length);
                analyzeMatches(state[key].matches);
                return;
            }

            // 检查是否包含 matchList
            if (state[key].matchList) {
                console.log(`✅ ${key}.matchList 存在，比赛数:`, state[key].matchList.length);
                analyzeMatches(state[key].matchList);
                return;
            }

            // 检查是否包含 schedule
            if (state[key].schedule) {
                console.log(`✅ ${key}.schedule 存在`);
                console.log('schedule 键:', Object.keys(state[key].schedule));
            }
        }
    }

    // 如果没找到，遍历所有键查找包含 matches 的对象
    console.log('\n🔍 深度搜索包含 matches 的对象...');
    for (const key of Object.keys(state)) {
        const obj = state[key];
        if (obj && typeof obj === 'object') {
            if (obj.matches && Array.isArray(obj.matches)) {
                console.log(`✅ 在 ${key}.matches 找到比赛数据，数量:`, obj.matches.length);
                analyzeMatches(obj.matches);
                return;
            }
            // 检查二级对象
            for (const subKey of Object.keys(obj)) {
                if (obj[subKey] && obj[subKey].matches && Array.isArray(obj[subKey].matches)) {
                    console.log(`✅ 在 ${key}.${subKey}.matches 找到比赛数据，数量:`, obj[subKey].matches.length);
                    analyzeMatches(obj[subKey].matches);
                    return;
                }
            }
        }
    }

    console.error('❌ 未找到比赛数据');

    // 分析比赛数据
    function analyzeMatches(matches) {
        console.log('\n=== 比赛数量:', matches.length, '===');

        if (matches.length === 0) {
            console.error('❌ matches 数组为空');
            return;
        }

        // 打印第一个比赛的完整结构
        console.log('\n=== 第一个比赛完整结构 ===');
        console.log(JSON.stringify(matches[0], null, 2));

        // 打印所有比赛的摘要
        console.log('\n=== 所有比赛摘要 ===');
        matches.forEach((match, i) => {
            const matchId = match.matchId || match.id || 'N/A';
            const home = match.homeTeamName || match.homeTeam || '?';
            const away = match.awayTeamName || match.awayTeam || '?';
            const homeScore = match.homeScore ?? '?';
            const awayScore = match.awayScore ?? '?';
            const round = match.roundStage || match.stage || '?';
            console.log(`${i + 1}. ${matchId}: ${home} ${homeScore} - ${awayScore} ${away} [${round}]`);
        });

        // 检查图片字段
        console.log('\n=== 图片字段检查 ===');
        const first = matches[0];
        console.log('coverImage:', first.coverImage ? '✅ ' + first.coverImage.substring(0, 80) + '...' : '❌ 无');
        console.log('homeTeamLogo:', first.homeTeamLogo ? '✅ ' + first.homeTeamLogo.substring(0, 80) + '...' : '❌ 无');
        console.log('awayTeamLogo:', first.awayTeamLogo ? '✅ ' + first.awayTeamLogo.substring(0, 80) + '...' : '❌ 无');
        console.log('backgroundImage:', first.backgroundImage ? '✅ ' + first.backgroundImage.substring(0, 80) + '...' : '❌ 无');

        // 检查 4459814
        const target = matches.find(m => (m.matchId || m.id) === '4459814');
        console.log('\n=== 4459814 检查 ===');
        if (target) {
            console.log('✅ 找到:', target.homeTeamName || target.homeTeam, 'vs', target.awayTeamName || target.awayTeam);
        } else {
            console.log('❌ 未找到 4459814');
            console.log('前5个 matchId:', matches.slice(0, 5).map(m => m.matchId || m.id).join(', '));
        }

        // 保存到全局变量
        window._xhsWorldCupData = {
            matches: matches,
            timestamp: new Date().toISOString()
        };
        console.log('\n✅ 数据已保存到 window._xhsWorldCupData');
    }
})();
