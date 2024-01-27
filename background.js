Date.prototype.getWeek = function() {
    var date = new Date(this.getTime());
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() + 3 - (date.getDay() + 6) % 7);
    var week1 = new Date(date.getFullYear(), 0, 4);
    return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

var connected = false,
    status = 'invisible',
    wasStatusMod = false,
    socket,
    settings = {},
    news = {},
    orderHistory = [],
    checkLists = {},
    JWT,
    _ga,
    buys

//Инициализация настроек расширения
document.addEventListener('DOMContentLoaded', async ()=> {
    await initializeConfig()
    let cookies = await new Promise((resolve)=> {
        chrome.cookies.getAll({domain: '.warframe.market'}, (cookies)=> {
            resolve(cookies)
        })
    })
    cookies.forEach((cookie)=> {
        if (cookie.name == '_ga') _ga = cookie.value
        else if (cookie.name == 'JWT') JWT = cookie.value
    })

    typeof WebSocket !== 'undefined' && function connect() {
        socket = new WebSocket('wss://warframe.market/socket?platform=pc')
        socket.onopen = ()=> {
            socket.send('{"type":"@WS/USER/SET_STATUS","payload":"invisible"}')
            socket.send('{"type":"@WS/SUBSCRIBE/MOST_RECENT"}')
            connected = true
            chrome.runtime.sendMessage({ action: 'status', status: connected })
        }
        socket.onerror = (err)=> {
            socket.onclose = null
            connected = false
            chrome.runtime.sendMessage({ action: 'status', status: connected })
            socket.close()
            connect()
        }
        socket.onmessage = onMessage
        socket.onclose = (e)=> {
            connected = false
            chrome.runtime.sendMessage({ action: 'status', status: connected })
            connect()
        }
    }()

    requestNews()
    setInterval(()=> checkListsReset(), 60000)
    setInterval(()=> requestNews(), 60000)
    setInterval(()=> updateBuys(), 300000)
})

async function parseURL(url) {
    try {
        response = await fetch(url)
    } catch (e) {
        if (e == 'TypeError: Failed to fetch') {
            console.log(error)
            return
        } else {
            console.log(e.stack)
            return
        }
    }
    
    if (!response.ok) return

    let html = await response.text()
    let doc = new DOMParser().parseFromString(html, 'text/html')
    return doc
}

async function initializeConfig() {
    buys = await getValue('buys')
    news = await getValue('news')
    orderHistory = await getValue('orderHistory')
    checkLists = await getValue('checkLists')
    settings = await getValue('settings')
    if (buys == null) buys = []
    if (news == null) news = {}
    if (orderHistory == null) orderHistory = []
    if (checkLists == null) {
        checkLists = {
            day_last_reset: 0,
            week_last_reset: 0,
            day: [],
            week: []
        }
    }
    if (settings == null) {
        settings = {
            inject: false,
            animation: true,
            notifVolume: 0.5,
            notifActive: true,
            platinum: {
                blackList: [],
                activePlatinum: false,
                instCopyPlatinum: false,
                minPricePlatinum: 2,
                maxPricePlatinum: 9999,
                minEfficiPlatinum: 25,
                minBenefitPlatinum: 5,
                openTabPlatinum: false,
                autoUpdatePricePlatinum: false,
                ignoreNoPopPlatinum: true
            },
            news: {
                eventsNews: false,
                traderNews: false,
                sortieNews: false,
                archonNews: false,
                alertsNews: false,
                newsNews: false,
                dailyDealsNews: false,
                teshinDealsNews: false,
                fissures: {
                    activeFissuresNews: false,
                    missDefNews: true,
                    missCleanNews: true,
                    missSurvNews: true,
                    missSaboNews: true,
                    missInterNews: true,
                    missFailNews: true,
                    missEspiNews: true,
                    missMDefNews: true,
                    missSaveNews: true,
                    missCaptNews: true,
                    missExcNews: true,
                    missVolNews: true,
                    missSkiNews: true,
                    missOrfNews: true
                },
                nightwave: {
                    activeNightwaveNews: false,
                    rew1000News: true,
                    rew4500News: true,
                    rew7000News: true
                },
                invasions: {
                    activeInvasionsNews: false,
                    rewInjecNews: true,
                    rewFildNews: true,
                    rewMutatNews: true,
                    rewCoordNews: true,
                    rewOtherNews: true
                },
                cycles: {
                    activeCyclesNews: false,
                    cycleCetusNews: true,
                    cycleEarthNews: true,
                    cycleVallisNews: true,
                    cycleCambionNews: true,
                    cycleZarimanNews: true
                }
            }
        }
    }
}

chrome.webNavigation.onCompleted.addListener((details)=> {
    if (details.url.match(/https:\/\/warframe.market\/ru\/auctions\/*/)) {
        if (details.parentFrameId != -1) return
        if (!settings.inject) return
        chrome.tabs.executeScript(details.tabId, { file: 'inject.js' }, (result)=> {})
    }
})


chrome.webRequest.onBeforeSendHeaders.addListener((details)=> {
    if (details.initiator != document.location.origin) return
    if (details.requestHeaders.some((el)=> el.name == 'Origin')) {
        details.requestHeaders.forEach((el, i)=> {
            if (el.name == 'Origin') details.requestHeaders[i].value = 'https://warframe.market'
        })
    } else {
        details.requestHeaders.push({ name: 'Origin', value: 'https://warframe.market' })
    }
    if (details.requestHeaders.some((el)=> el.name == 'Cookie')) {
        details.requestHeaders.forEach((el, i)=> {
            if (el.name == 'Cookie') details.requestHeaders[i].value = '_ga='+_ga+'; JWT='+JWT
        })
    } else {
        details.requestHeaders.push({ name: 'Cookie', value: '_ga='+_ga+'; JWT='+JWT })
    }
    return { requestHeaders: details.requestHeaders }
}, {urls: ['wss://*.warframe.market/*']}, ['blocking', 'requestHeaders', 'extraHeaders'])

async function onMessage(e) {
    let data = JSON.parse(e.data)
    if (data.type == '@WS/SUBSCRIPTIONS/MOST_RECENT/NEW_ORDER') {
        if (data.payload.order.order_type == 'sell' && data.payload.order.platform == 'pc' && data.payload.order.visible) {
            let icon = (data.payload.order.item.sub_icon == null) ? data.payload.order.item.thumb : data.payload.order.item.sub_icon
            chrome.runtime.sendMessage({ action: 'check', message: icon })
            if (settings.platinum.activePlatinum) platinumChecker(data)
        }
    } else if (data.type == '@WS/USER/SET_STATUS') {
        if (wasStatusMod == true) {
            wasStatusMod = false
            status = data.payload
            chrome.runtime.sendMessage({ action: 'set_status', status: data.payload })
        } else {
            wasStatusMod = true
            socket.send('{"type":"@WS/USER/SET_STATUS","payload":"'+status+'"}')
        }
        
    }
}

function sendNotification(title, message, module) {
    message = String(message)
    doLog(title+'\n'+message, '#9fe2bf')
    let audio = new Audio('audio/notif_'+module+'.mp3')
	audio.volume = settings.notifVolume
	audio.play()
    if (!settings.notifActive) return
    let notification = {
        type: 'basic',
        iconUrl: 'images/icon.png',
        title: title,
        message: message,
        silent: true
    }
    chrome.notifications.create('', notification, ()=> {})
}

async function setValue(key, value) {
    return new Promise((resolve)=> {
        chrome.storage.local.set({[key]: value}, (data)=> {
            if (chrome.runtime.lastError) {
                console.log('Ошибка сохранение данных')
                reject(chrome.runtime.lastError)
            } else {
                resolve(data)
            }
        })
    })
}

async function getValue(name) {
    return new Promise((resolve)=> {
        chrome.storage.local.get(name, (data)=> {
            if (chrome.runtime.lastError) {
                console.log('Ошибка получения сохраненных данных')
                reject(chrome.runtime.lastError)
            } else {
                resolve(data[name])
            }
        })
    })
}

chrome.storage.onChanged.addListener((changes, namespace)=> {
    for (let key in changes) {
        let storageChange = changes[key]
        if (key == 'settings') settings = storageChange.newValue
        else if (key == 'orderHistory') orderHistory = storageChange.newValue
        else if (key == 'buys') buys = storageChange.newValue
        else if (key == 'checkLists') checkLists = storageChange.newValue
    }
})

chrome.runtime.onInstalled.addListener((details)=> {
    if (details.reason == 'install') {
        setTimeout(()=> { 
            chrome.runtime.openOptionsPage() 
        }, 5000)
    }
})

async function wait(ms) {
    return new Promise((resolve)=> setTimeout(()=> resolve(), ms))
}

function requestSold(item) {
    return new Promise((resolve)=>{
        fetch('https://api.warframe.market/v1/items/'+item+'/statistics')
        .then((response)=> {
            response.json()
            .then(async (data)=> {
                resolve(data.payload.statistics_closed['48hours'])
            })
        })
    })
}

function doLog(message, textColor) {
    if (textColor == null) textColor = '#ccc'
    let titleDis = 'color: white; background-color: #6d5287'
    console.log('%c'+message, 'color: '+textColor)
}

async function platinumChecker(data) {
    if (data.payload.order.platinum < settings.platinum.minPricePlatinum || data.payload.order.platinum > settings.platinum.maxPricePlatinum) return
    try {
        if (settings.platinum.blackList.some((el)=> el.name == data.payload.order.item.ru.item_name)) return

        let soldsHist = await requestSold(data.payload.order.item.url_name)
        if (typeof data.payload.order.mod_rank !== 'undefined') {
            soldsHist = soldsHist.filter((el)=> el.mod_rank == data.payload.order.mod_rank)
        } else if (typeof data.payload.order.subtype !== 'undefined') {
            soldsHist = soldsHist.filter((el)=> el.subtype == data.payload.order.subtype)
        }
        
        let startInd = (soldsHist.length >= 5) ? soldsHist.length-5 : 0
        soldsHist = soldsHist.slice(startInd, soldsHist.length)
        if (soldsHist.length < 1) return
        let avgPrice = getAvgPrice(soldsHist)/soldsHist.length
        let maxPrice = getMaxPrice(soldsHist)
        let price = Math.round((maxPrice-avgPrice)/2+avgPrice)

        let benefit = Math.round(price-data.payload.order.platinum)
        if (benefit < settings.platinum.minBenefitPlatinum) return
        let coeff = Number(((price/data.payload.order.platinum*100)-100).toFixed(2))
        if (coeff < settings.platinum.minEfficiPlatinum) return
        
        if (settings.platinum.ignoreNoPopPlatinum) {
            let solds = 0
            soldsHist.forEach((el)=> solds += el.volume)
            if (solds < 16 || soldsHist.length < 5) return
        }
        let date = new Date()
        let time = date.toLocaleString('ru-US')
        let orderData = {
            module: 'platinum',
            id: data.payload.order.id,
            item_id: data.payload.order.item.id,
            date: time,
            name: {
                ru: data.payload.order.item.ru.item_name,
                de: data.payload.order.item.de.item_name,
                en: data.payload.order.item.en.item_name,
                fr: data.payload.order.item.fr.item_name,
                es: data.payload.order.item.es.item_name,
                ko: data.payload.order.item.ko.item_name,
                pl: data.payload.order.item.pl.item_name,
                pt: data.payload.order.item.pt.item_name,
                sv: data.payload.order.item.sv.item_name
            },
            url_name: data.payload.order.item.url_name,
            seller: data.payload.order.user.ingame_name,
            region: data.payload.order.region.toUpperCase(),
            price: data.payload.order.platinum,
            quantity: data.payload.order.quantity,
            coeff: coeff,
            benefit: benefit
        }
        orderData.icon = (data.payload.order.item.sub_icon == null) ? data.payload.order.item.thumb : data.payload.order.item.sub_icon
        if (typeof data.payload.order.mod_rank !== 'undefined') {
            orderData.rank = data.payload.order.mod_rank
            orderData.max_rank = data.payload.order.item.mod_max_rank
        } else if (typeof data.payload.order.subtype !== 'undefined') {
            orderData.subtype = data.payload.order.subtype
            orderData.subtypes = data.payload.order.item.subtypes
        }
        orderHistory.push(orderData)
        setValue('orderHistory', orderHistory)
        chrome.runtime.sendMessage({ action: 'buy', order: orderData })
        sendNotification(data.payload.order.item.ru.item_name, genNotifText(data.payload, benefit, false), 'PlatinumChecker')
        if (settings.platinum.instCopyPlatinum) copyToClipboard(genTextForCopy(orderData))
        if (settings.platinum.openTabPlatinum) chrome.tabs.create({url: 'https://warframe.market/ru/items/'+data.payload.order.item.url_name})
    } catch(e) {
        console.log(e)
    }
}

function genTextForCopy(orderData) {
    let text
    switch (orderData.region) {
        case 'EN':
            text = '/w '+orderData.seller+' Hi! I want to buy: "'+orderData.name[orderData.region.toLowerCase()]
            if (typeof orderData.rank !== 'undefined') text += ' (rank '+orderData.rank+')'
            text += '" for '+orderData.price+' platinum. (warframe.market)'
            break
        case 'RU':
            text = '/w '+orderData.seller+' Привет! я хочу купить: "'+orderData.name[orderData.region.toLowerCase()]
            if (typeof orderData.rank !== 'undefined') text += ' (ранг '+orderData.rank+')'
            text += '" за '+orderData.price+' '+pluris(orderData.price, ['платину', 'платины', 'платины'])+'. (warframe.market)'
            break
        case 'KO':
            text = '/w '+orderData.seller+' 님 안녕하세요! "'+orderData.name[orderData.region.toLowerCase()]
            if (typeof orderData.rank !== 'undefined') text += ' (rank '+orderData.rank+')'
            text += '" 을 '+orderData.price+'에 구매하고 싶습니다. (warframe.market)'
            break
        case 'FR':
            text = '/w '+orderData.seller+' Salut!je voudrais acheter: "'+orderData.name[orderData.region.toLowerCase()]
            if (typeof orderData.rank !== 'undefined') text += ' (rank '+orderData.rank+')'
            text += '" pour '+orderData.price+' platine. (warframe.market)'
            break
        case 'SV':
            text = '/w '+orderData.seller+' Tjenare! Jag skulle vilja köp: "'+orderData.name[orderData.region.toLowerCase()] 
            if (typeof orderData.rank !== 'undefined') text += ' (rank '+orderData.rank+')'
            text += '" för '+orderData.price+' platinum. (warframe.market)'
            break
        case 'DE':
            text ='/w '+orderData.seller+' Hallo, ich möchte folgendes kaufen: "'+orderData.name[orderData.region.toLowerCase()] 
            if (typeof orderData.rank !== 'undefined') text += ' (rank '+orderData.rank+')'
            text += '" für '+orderData.price+' Platin. (warframe.market)'
            break
    }
    return text
}

function pluris(number, titles) {  
    cases = [2, 0, 1, 1, 1, 2]
    return titles[ (number%100>4 && number%100<20)? 2 : cases[(number%10<5)?number%10:5] ]
}

function genNotifText(data, benefit, bool) {
    let text = 'Количество: '+data.order.quantity+' шт.\n'
    text += 'Цена: '+data.order.platinum+' пл.\n'
    if (!bool) text += 'Выгода: '+benefit+' пл.\n'
    else text += 'Эффективность: '+benefit+' дук.\n'
    if (typeof data.mod_rank !== 'undefined') text += 'Ранг: '+data.mod_rank+' / '+data.item.mod_max_rank+'\n'
    text += 'Продавец: ['+data.order.region.toUpperCase()+'] '+data.order.user.ingame_name
    return text
}

async function editItemToMarket(order) {
    let doc = await parseURL('https://warframe.market')
    let csrf = doc.querySelector('[name="csrf-token"]').getAttribute('content')
    try {
        let body = '{\"order_id\":\"'+order.order_id+'\",\"platinum\":'+order.price+',\"quantity\":'+order.quantity+',\"visible\":true'
        body += (order.rank != null && typeof order.rank !== 'undefined') ? ',\"rank\":'+order.rank : ''
        body += (order.subtype != null && typeof order.subtype !== 'undefined') ? ',\"subtype\":\"'+order.subtype+'\"' : ''
        body += '}'
        response = await fetch("https://api.warframe.market/v1/profile/orders/"+order.order_id+"?include=top", {
            "headers": {
                "content-type": "application/json",
                "x-csrftoken": csrf
            },
            "body": body,
            "method": "PUT",
            "mode": "cors",
            "credentials": "include"
        })
    } catch (e) {
        return { success: false, message: 'response_error' }
    }
    let data = await response.json()
    if (typeof data.payload !== 'undefined') {
        buys.forEach((el, i)=> {
            if (el.id == order.id) {
                buys[i].price = order.price
                buys[i].quantity = order.quantity
            }
        })
        setValue('buys', buys)
        return { success: true, message: 'response.ok' }
    } else if (!response.ok) {
        return { success: false, message: 'response.ok != true' }
    }
    return { success: false, message: 'unknown_error' }
}

async function updateBuys() {
    if (!settings.platinum.autoUpdatePricePlatinum) return
    chrome.runtime.sendMessage({ action: 'update_prices', process: true })
    if (buys.length == 0) chrome.runtime.sendMessage({ action: 'update_prices', process: false })
    buys.forEach(async (el, i)=> {
        let soldsHist = await requestSold(buys[buys.length-i-1].item_url)
        if (typeof buys[buys.length-i-1].rank !== 'undefined') {
            soldsHist = soldsHist.filter((el)=> el.mod_rank == buys[buys.length-i-1].rank)
        } else if (typeof buys[buys.length-i-1].subtype !== 'undefined') {
            soldsHist = soldsHist.filter((el)=> el.subtype == buys[buys.length-i-1].subtype)
        }

        let startInd = (soldsHist.length >= 5) ? soldsHist.length-5 : 0
        soldsHist = soldsHist.slice(startInd, soldsHist.length)
        let avgPrice = getAvgPrice(soldsHist)/soldsHist.length
        let maxPrice = getMaxPrice(soldsHist)
        let price = (avgPrice == 0) ? 0 : Math.round((maxPrice-avgPrice)/2+avgPrice)
        if (buys[buys.length-i-1].price != price && price != 0) {
            if (buys[buys.length-i-1].order_id != '') await editItemToMarket({ id: buys[buys.length-i-1].id, order_id: buys[buys.length-i-1].order_id, price: price, quantity: buys[buys.length-i-1].quantity, rank: buys[buys.length-i-1].rank, subtype: buys[buys.length-i-1].subtype })
            else buys[buys.length-i-1].price = price
        }
        if (price != 0) {
            let date = new Date()
            let time = date.toLocaleString('ru-US')
            buys[buys.length-i-1].market_price_date = time
            await setValue('buys', buys)
        }
        
        chrome.runtime.sendMessage({ action: 'update_prices', index: i })
        if (buys.length-1 == i) chrome.runtime.sendMessage({ action: 'update_prices', process: false })
    })
}

function checkListsReset() {
    if (new Date().getUTCDate() != new Date(checkLists.day_last_reset).getUTCDate() || new Date().getUTCMonth() != new Date(checkLists.day_last_reset).getUTCMonth()) {
        checkLists.day_last_reset = Date.now()
        checkLists.day.forEach((el, i)=> {
            checkLists.day[i].checked = false
        })

        if (new Date().getWeek() != new Date(checkLists.week_last_reset).getWeek()) {
            checkLists.week_last_reset = Date.now()
            checkLists.week.forEach((el, i)=> {
                checkLists.week[i].checked = false
            })
        }
    }
    setValue('checkLists', checkLists)
}

async function requestNews() {
    try {
        response = await fetch('https://api.warframestat.us/pc?language=ru')
    } catch (e) {
        console.log('Ошибка обновления новостей:', e)
        return
    }

    if (!response.ok) return
    let data = await response.json()
    let date = new Date()
    let time = date.toLocaleString('ru-US')
    data.lastUpdate = time
    let oldNews = news
    news = data
    newsCheck(oldNews)
    await setValue('news', data)
    chrome.runtime.sendMessage({ action: 'update_news' })
}

function copyToClipboard(text) {
    let input = document.createElement('input')
    input.value = text
    document.body.append(input)
    input.select()
    document.execCommand('Copy')
    setTimeout(()=> input.remove(), 1000)
}

async function forInvasions(oldNews, arr, i = 0) {
    if (arr.length == i) return
    if (arr[i].completed) {
        await forInvasions(oldNews, arr, ++i)
        return
    }
    let check = oldNews.invasions.some((old)=> {
        if (old.id == arr[i].id) return true 
        else return false
    })
    if (check) {
        await forInvasions(oldNews, arr, ++i)
        return
    }
    if (arr[i].defenderReward.countedItems.length > 0 && arr[i].attackerReward.countedItems.length > 0) {
        if ((arr[i].defenderReward.countedItems[0].key == 'Fieldron' || arr[i].attackerReward.countedItems[0].key == 'Fieldron') && settings.news.invasions.rewFildNews) {
            sendNotification('Вторжение', arr[i].node+' - '+arr[i].desc+genInvStr(arr[i]), 'NewsChecker')
            await wait(2000)
        } else if ((arr[i].defenderReward.countedItems[0].key == 'Detonite Injector' || arr[i].attackerReward.countedItems[0].key == 'Detonite Injector') && settings.news.invasions.rewInjecNews) {
            sendNotification('Вторжение', arr[i].node+' - '+arr[i].desc+genInvStr(arr[i]), 'NewsChecker')
            await wait(2000)
        } else if ((arr[i].defenderReward.countedItems[0].key == 'Mutagen Mass' || arr[i].attackerReward.countedItems[0].key == 'Mutagen Mass') && settings.news.invasions.rewMutatNews) {
            sendNotification('Вторжение', arr[i].node+' - '+arr[i].desc+genInvStr(arr[i]), 'NewsChecker')
            await wait(2000)
        } else if ((arr[i].defenderReward.countedItems[0].key == 'Mutalist Alad V Nav Coordinate' || arr[i].attackerReward.countedItems[0].key == 'Mutalist Alad V Nav Coordinate') && settings.news.invasions.rewCoordNews) {
            sendNotification('Вторжение', arr[i].node+' - '+arr[i].desc+genInvStr(arr[i]), 'NewsChecker')
            await wait(2000)
        } else if ((arr[i].attackerReward.countedItems[0].key != 'Fieldron' && arr[i].attackerReward.countedItems[0].key != 'Detonite Injector' && arr[i].attackerReward.countedItems[0].key != 'Mutagen Mass' && arr[i].attackerReward.countedItems[0].key != 'Mutalist Alad V Nav Coordinate' && settings.news.invasions.rewOtherNews) || (arr[i].defenderReward.countedItems[0].key != 'Fieldron' && arr[i].defenderReward.countedItems[0].key != 'Detonite Injector' && arr[i].defenderReward.countedItems[0].key != 'Mutagen Mass' && arr[i].defenderReward.countedItems[0].key != 'Mutalist Alad V Nav Coordinate' && settings.news.invasions.rewOtherNews)){
            sendNotification('Вторжение', arr[i].node+' - '+arr[i].desc+genInvStr(arr[i]), 'NewsChecker')
            await wait(2000)
        }
    } else if (arr[i].attackerReward.countedItems.length > 0) {
        if (arr[i].attackerReward.countedItems[0].key == 'Fieldron' && settings.news.invasions.rewFildNews) {
            sendNotification('Вторжение', arr[i].node+' - '+arr[i].desc+genInvStr(arr[i]), 'NewsChecker')
            await wait(2000)
        } else if (arr[i].attackerReward.countedItems[0].key == 'Detonite Injector' && settings.news.invasions.rewInjecNews) {
            sendNotification('Вторжение', arr[i].node+' - '+arr[i].desc+genInvStr(arr[i]), 'NewsChecker')
            await wait(2000)
        } else if (arr[i].attackerReward.countedItems[0].key == 'Mutagen Mass' && settings.news.invasions.rewMutatNews) {
            sendNotification('Вторжение', arr[i].node+' - '+arr[i].desc+genInvStr(arr[i]), 'NewsChecker')
            await wait(2000)
        } else if (invasion.attackerReward.countedItems[0].key == 'Mutalist Alad V Nav Coordinate' && settings.news.invasions.rewCoordNews) {
            sendNotification('Вторжение', arr[i].node+' - '+arr[i].desc+genInvStr(arr[i]), 'NewsChecker')
            await wait(2000)
        } else if (invasion.attackerReward.countedItems[0].key != 'Fieldron' && arr[i].attackerReward.countedItems[0].key != 'Detonite Injector' && arr[i].attackerReward.countedItems[0].key != 'Mutagen Mass' && arr[i].attackerReward.countedItems[0].key != 'Mutalist Alad V Nav Coordinate' && settings.news.invasions.rewOtherNews) {
            sendNotification('Вторжение', arr[i].node+' - '+arr[i].desc+genInvStr(arr[i]), 'NewsChecker')
            await wait(2000)
        }
    } else if (arr[i].defenderReward.countedItems.length > 0) {
        if (arr[i].defenderReward.countedItems[0].key == 'Fieldron' && settings.news.invasions.rewFildNews) {
            sendNotification('Вторжение', arr[i].node+' - '+arr[i].desc+genInvStr(arr[i]), 'NewsChecker')
            await wait(2000)
        } else if (arr[i].defenderReward.countedItems[0].key == 'Detonite Injector' && settings.news.invasions.rewInjecNews) {
            sendNotification('Вторжение', arr[i].node+' - '+arr[i].desc+genInvStr(arr[i]), 'NewsChecker')
            await wait(2000)
        } else if (arr[i].defenderReward.countedItems[0].key == 'Mutagen Mass' && settings.news.invasions.rewMutatNews) {
            sendNotification('Вторжение', arr[i].node+' - '+arr[i].desc+genInvStr(arr[i]), 'NewsChecker')
            await wait(2000)
        } else if (arr[i].defenderReward.countedItems[0].key == 'Mutalist Alad V Nav Coordinate' && settings.news.invasions.rewCoordNews) {
            sendNotification('Вторжение', arr[i].node+' - '+arr[i].desc+genInvStr(arr[i]), 'NewsChecker')
            await wait(2000)
        } else if (arr[i].defenderReward.countedItems[0].key != 'Fieldron' && arr[i].defenderReward.countedItems[0].key != 'Detonite Injector' && arr[i].defenderReward.countedItems[0].key != 'Mutagen Mass' && arr[i].defenderReward.countedItems[0].key != 'Mutalist Alad V Nav Coordinate' && settings.news.invasions.rewOtherNews) {
            sendNotification('Вторжение', arr[i].node+' - '+arr[i].desc+genInvStr(arr[i]), 'NewsChecker')
            await wait(2000)
        }
    }
    await forInvasions(oldNews, arr, ++i)
    return
}

async function forFissures(oldNews, arr, i = 0) {
    if (arr.length == i) return
    let check = oldNews.fissures.some((old)=> {
        if (old.id == arr[i].id) return true
        else return false
    })
    if (check) {
        await forFissures(oldNews, arr, ++i)
        return
    }
    let prefix = (arr[i].isHard) ? ' ✦' : ''
    prefix += (arr[i].isStorm) ? ' ☼' : ''
    if (arr[i].missionKey == 'Defense' && settings.news.fissures.missDefNews) {
        sendNotification('Разрыв бездны'+prefix, arr[i].node+' - '+arr[i].missionType+' ['+arr[i].tier+']', 'NewsChecker')
        await wait(2000)
    } else if (arr[i].missionKey == 'Extermination' && settings.news.fissures.missCleanNews) {
        sendNotification('Разрыв бездны'+prefix, arr[i].node+' - '+arr[i].missionType+' ['+arr[i].tier+']', 'NewsChecker')
        await wait(2000)
    } else if (arr[i].missionKey == 'Survival' && settings.news.fissures.missSurvNews) {
        sendNotification('Разрыв бездны'+prefix, arr[i].node+' - '+arr[i].missionType+' ['+arr[i].tier+']', 'NewsChecker')
        await wait(2000)
    } else if (arr[i].missionKey == 'Sabotage' && settings.news.fissures.missSaboNews) {
        sendNotification('Разрыв бездны'+prefix, arr[i].node+' - '+arr[i].missionType+' ['+arr[i].tier+']', 'NewsChecker')
        await wait(2000)
    } else if (arr[i].missionKey == 'Interception' && settings.news.fissures.missInterNews) {
        sendNotification('Разрыв бездны'+prefix, arr[i].node+' - '+arr[i].missionType+' ['+arr[i].tier+']', 'NewsChecker')
        await wait(2000)
    } else if (arr[i].missionKey == 'Rescue' && settings.news.fissures.missSaveNews) {
        sendNotification('Разрыв бездны'+prefix, arr[i].node+' - '+arr[i].missionType+' ['+arr[i].tier+']', 'NewsChecker')
        await wait(2000)
    } else if (arr[i].missionKey == 'Mobile Defense' && settings.news.fissures.missMDefNews) {
        sendNotification('Разрыв бездны'+prefix, arr[i].node+' - '+arr[i].missionType+' ['+arr[i].tier+']', 'NewsChecker')
        await wait(2000)
    } else if (arr[i].missionKey == 'Disruption' && settings.news.fissures.missFailNews) {
        sendNotification('Разрыв бездны'+prefix, arr[i].node+' - '+arr[i].missionType+' ['+arr[i].tier+']', 'NewsChecker')
        await wait(2000)
    } else if (arr[i].missionKey == 'Spy' && settings.news.fissures.missEspiNews) {
        sendNotification('Разрыв бездны'+prefix, arr[i].node+' - '+arr[i].missionType+' ['+arr[i].tier+']', 'NewsChecker')
        await wait(2000)
    } else if (arr[i].missionKey == 'Capture' && settings.news.fissures.missCaptNews) {
        sendNotification('Разрыв бездны'+prefix, arr[i].node+' - '+arr[i].missionType+' ['+arr[i].tier+']', 'NewsChecker')
        await wait(2000)
    } else if (arr[i].missionKey == 'Excavation' && settings.news.fissures.missExcNews) {
        sendNotification('Разрыв бездны'+prefix, arr[i].node+' - '+arr[i].missionType+' ['+arr[i].tier+']', 'NewsChecker')
        await wait(2000)
    } else if (arr[i].missionKey == 'Volatile' && settings.news.fissures.missVolNews) {
        sendNotification('Разрыв бездны'+prefix, arr[i].node+' - '+arr[i].missionType+' ['+arr[i].tier+']', 'NewsChecker')
        await wait(2000)
    } else if (arr[i].missionKey == 'Skirmish' && settings.news.fissures.missSkiNews) {
        sendNotification('Разрыв бездны'+prefix, arr[i].node+' - '+arr[i].missionType+' ['+arr[i].tier+']', 'NewsChecker')
        await wait(2000)
    } else if (arr[i].missionKey == 'Orfix' && settings.news.fissures.missOrfNews) {
        sendNotification('Разрыв бездны'+prefix, arr[i].node+' - '+arr[i].missionType+' ['+arr[i].tier+']', 'NewsChecker')
        await wait(2000)
    } 
    await forFissures(oldNews, arr, ++i)
    return
}

async function forAlerts(oldNews, arr, i = 0) {
    if (arr.length == i) return
    let check = oldNews.alerts.some((old)=> {
        if (old.id == arr[i].id) return true
        else return false
    })
    if (check) {
        await forAlerts(oldNews, arr, ++i)
        return
    }
    sendNotification('Тревога', arr[i].mission.node+' - '+arr[i].mission.description, 'NewsChecker')
    await wait(2000)
    await forAlerts(oldNews, arr, ++i)
    return
}

async function forEvents(oldNews, arr, i = 0) {
    if (arr.length == i) return
    let check = oldNews.events.some((old)=> {
        if (old.id == arr[i].id) return true
        else return false
    })
    if (check) {
        await forEvents(oldNews, arr, ++i)
        return
    }
    let desc = arr[i].description+' - ('+arr[i].faction+')'
    if (!arr[i].faction) desc = arr[i].description+' - '+arr[i].node
    if (!arr[i].node) desc = arr[i].description+' - '+arr[i].victimNode
    if (!arr[i].victimNode) desc = ''
    sendNotification('Событие', desc, 'NewsChecker')
    await wait(2000)
    await forEvents(oldNews, arr, ++i)
    return
}

async function forNews(oldNews, arr, i = 0) {
    if (arr.length == i) return
    let check = oldNews.news.some((old)=> {
        if (old.id == arr[i].id) return true
        else return false
    })
    if (check) {
        await forNews(oldNews, arr, ++i)
        return
    }
    sendNotification('Новость от warframe.com', arr[i].message, 'NewsChecker')
    await wait(2000)
    await forNews(oldNews, arr, ++i)
    return
}

async function forNightwave(oldNews, arr, i = 0) {
    if (arr.length == i) return
    let check = oldNews.nightwave.activeChallenges.some((old)=> {
        if (old.id == arr[i].id) return true
        else return false
    })

    if (check) {
        await forNightwave(oldNews, arr, ++i)
        return
    }
    if (arr[i].reputation == 7000 && settings.news.nightwave.rew7000News) {
        sendNotification('Задание ночной волны', arr[i].title+' - ['+arr[i].reputation+']', 'NewsChecker')
        await wait(2000)
    } else if (arr[i].reputation == 4500 && settings.news.nightwave.rew4500News) {
        sendNotification('Задание ночной волны', arr[i].title+' - ['+arr[i].reputation+']', 'NewsChecker')
        await wait(2000)
    } else if (arr[i].reputation == 1000 && settings.news.nightwave.rew1000News) {
        sendNotification('Задание ночной волны', arr[i].title+' - ['+arr[i].reputation+']', 'NewsChecker')
        await wait(2000)
    }
    await forNightwave(oldNews, arr, ++i)
    return
}

async function newsCheck(oldNews) {
    //Циклы
    if (settings.news.cycles.activeCyclesNews) {
        //равнины эйдолона
        if (settings.news.cycles.cycleCetusNews && typeof oldNews.cetusCycle !== 'undefined' && typeof news.cetusCycle !== 'undefined') {
            if (news.cetusCycle.id != oldNews.cetusCycle.id) {
                if (!news.cetusCycle.isDay) {
                    sendNotification('Смена времени суток', 'На Равнинах Эйдолона сейчас ночь. \nДо рассвета: '+checkTime(news.cetusCycle.expiry), 'NewsChecker')
                    await wait(2000)
                } else {
                    sendNotification('Смена времени суток', 'На Равнинах Эйдолона сейчас день. \nДо заката: '+checkTime(news.cetusCycle.expiry), 'NewsChecker')
                    await wait(2000)
                }
            }
        }
    
        //земля
        if (settings.news.cycles.cycleEarthNews && typeof oldNews.earthCycle !== 'undefined' && typeof news.earthCycle !== 'undefined') {
            if (news.earthCycle.id != oldNews.earthCycle.id) {
                if (!news.earthCycle.isDay) {
                    sendNotification('Смена времени суток', 'На Земле сейчас ночь. \nДо рассвета: '+checkTime(news.earthCycle.expiry), 'NewsChecker')
                    await wait(2000)
                } else {
                    sendNotification('Смена времени суток', 'На Земле сейчас день. \nДо заката: '+checkTime(news.earthCycle.expiry), 'NewsChecker')
                    await wait(2000)
                }
            }
        }
    
        //долины сфер
        if (settings.news.cycles.cycleVallisNews && typeof oldNews.vallisCycle !== 'undefined' && typeof news.vallisCycle !== 'undefined') {
            if (news.vallisCycle.id != oldNews.vallisCycle.id) {
                if (!news.vallisCycle.isWarm) {
                    sendNotification('Изменение температуры', 'В Долине Сфер сейчас холодно. \nДо потепления: '+checkTime(news.vallisCycle.expiry), 'NewsChecker')
                    await wait(2000)
                } else {
                    sendNotification('Изменение температуры', 'В Долине Сфер сейчас тепло. \nДо похолодания: '+checkTime(news.vallisCycle.expiry), 'NewsChecker')
                    await wait(2000)
                }
            }
        }
    
        //дрейф
        if (settings.news.cycles.cycleCambionNews && typeof oldNews.cambionCycle !== 'undefined' && typeof news.cambionCycle !== 'undefined') {
            if (news.cambionCycle.id != oldNews.cambionCycle.id) {
                if (news.cambionCycle.active == 'vome') {
                    sendNotification('Цикл Фэз-Воум', 'В Камбионском Дрейфе сейчас цикл Воум. \nДо Фэз: '+checkTime(news.cambionCycle.expiry), 'NewsChecker')
                    await wait(2000)
                } else {
                    sendNotification('Цикл Фэз-Воум', 'В Камбионском Дрейфе сейчас цикл Фэз. \nДо Воум: '+checkTime(news.cambionCycle.expiry), 'NewsChecker')
                    await wait(2000)
                }
            }
        }

        //зариман
        if (settings.news.cycles.cycleZarimanNews && typeof oldNews.zarimanCycle !== 'undefined' && typeof news.zarimanCycle !== 'undefined') {
            if (news.cambionCycle.id != oldNews.cambionCycle.id) {
                if (news.zarimanCycle.isCorpus) {
                    sendNotification('Цикл Гринир-Корпуса', 'На Заримане сейчас цикл Корпуса. \nДо Гринир: '+checkTime(news.zarimanCycle.expiry), 'NewsChecker')
                    await wait(2000)
                } else {
                    sendNotification('Цикл Гринир-Корпуса', 'На Заримане сейчас цикл Гринир. \nДо Корпуса: '+checkTime(news.zarimanCycle.expiry), 'NewsChecker')
                    await wait(2000)
                }
            }
        }
    }

    //Ночная волна
    if (settings.news.nightwave.activeNightwaveNews && typeof oldNews.nightwave !== 'undefined' && typeof news.nightwave !== 'undefined') {    
        await forNightwave(oldNews, news.nightwave.activeChallenges)
    }

    //Вторжения
    if (settings.news.invasions.activeInvasionsNews && typeof oldNews.invasions !== 'undefined' && typeof news.invasions !== 'undefined') {
        news.invasions = news.invasions.sort((prev, next)=> prev.completion - next.completion).reverse()
        await forInvasions(oldNews, news.invasions)
    }

    //Разрывы
    if (settings.news.fissures.activeFissuresNews && typeof oldNews.fissures !== 'undefined' && typeof news.fissures !== 'undefined') {
        await forFissures(oldNews, news.fissures)
    }

    //Тревоги
    if (settings.news.alertsNews && typeof oldNews.alerts !== 'undefined' && typeof news.alerts !== 'undefined') {
        await forAlerts(oldNews, news.alerts)
    }

    //Предложения Дарво
    if (settings.news.dailyDealsNews && typeof oldNews.dailyDeals !== 'undefined' && typeof news.dailyDeals !== 'undefined') {
        news.dailyDeals.forEach(async (deal)=> {
            let check = oldNews.dailyDeals.some((old)=> {
                if (old.id == deal.id) return true
                else return false
            })
            if (!check) {
                sendNotification('Предложение Дарво', 'Предмет: '+deal.item+'\nПродано: '+deal.sold+'/'+deal.total+'\nСкидка: -'+deal.discount+'%\nЦена: '+deal.salePrice+' пл.', 'NewsChecker')
                await wait(2000)
            }
        })
    }

    //Предложение Тешина
    if (settings.news.teshinDealsNews && typeof oldNews.steelPath !== 'undefined' && typeof news.steelPath !== 'undefined') {
        if (oldNews.steelPath.currentReward.name != news.steelPath.currentReward.name) {
            sendNotification('Предложение Тешина', 'Предмет: '+news.steelPath.currentReward.name+'\nЦена: '+news.steelPath.currentReward.cost+' эс.', 'NewsChecker')
            await wait(2000)
        }
    }

    //Ивенты
    if (settings.news.eventsNews && typeof oldNews.events !== 'undefined' && typeof news.events !== 'undefined') {    
        await forEvents(oldNews, news.events)
    }

    //Новости
    if (settings.news.newsNews && typeof oldNews.news !== 'undefined' && typeof news.news !== 'undefined') {    
        await forNews(oldNews, news.news)
    }

    //Вылазка
    if (settings.news.sortieNews && typeof oldNews.archonHunt !== 'undefined' && typeof news.archonHunt !== 'undefined') {
        if (oldNews.archonHunt.id != news.archonHunt.id) {
            sendNotification('Архонты', 'Доступна охота. \nНападающий: '+news.archonHunt.boss, 'NewsChecker')
            await wait(2000)
        }
    }

    //Архонты
    if (settings.news.archonNews && typeof oldNews.sortie !== 'undefined' && typeof news.sortie !== 'undefined') {
        if (oldNews.sortie.id != news.sortie.id) {
            sendNotification('Вылазка', 'Вылазка обновлена. \nНападающий: '+news.sortie.boss, 'NewsChecker')
            await wait(2000)
        }
    }

    //Торговец бездны
    if (settings.news.traderNews && typeof oldNews.voidTrader !== 'undefined' && typeof news.voidTrader !== 'undefined') {
        if (news.voidTrader.active && news.voidTrader.active != oldNews.voidTrader.active) {
            sendNotification('Торговец бездны', 'Ожидает ❯❯❯  '+news.voidTrader.location, 'NewsChecker')
            await wait(2000)
        }
    }
}

function getMaxPrice(soldsHist) {
    let maxPrice = 0
    soldsHist.forEach((el)=> {
        if (typeof el.moving_avg === 'undefined') {
            if (maxPrice < el.avg_price) maxPrice = el.avg_price
        } else {
            if (maxPrice < el.moving_avg) maxPrice = el.moving_avg
        }
    })
    return maxPrice
}

function getAvgPrice(soldsHist) {
    let avgPrice = 0
    soldsHist.forEach((el)=> {
        if (typeof el.moving_avg === 'undefined') avgPrice += el.avg_price
        else avgPrice += el.moving_avg
    })
    return avgPrice
}

function diffSubtract(date1, date2) {
    return date2 - date1
}

function checkTime(time) {
    let now = new Date()
    let date = new Date(time)
    let ms_left = diffSubtract(now, date)
    let res = new Date(ms_left)

    let year = res.getUTCFullYear() - 1970+'г '
    if (res.getUTCFullYear() - 1970 == 0) year = ''
    let month = res.getUTCMonth()+'м '
    if (res.getUTCMonth() == 0) month = ''
    let days = res.getUTCDate() - 1+'д '
    if (res.getUTCDate() - 1 == 0) days = ''
    let hours = res.getUTCHours()+'ч '
    if (res.getUTCHours() == 0) hours = ''
    let minutes = res.getUTCMinutes()+'м '
    if (res.getUTCMinutes() == 0) minutes = ''
    let seconds = res.getUTCSeconds()+'с '
    if (res.getUTCSeconds() == 0) seconds = ''

    return year+month+days+hours+minutes+seconds
}

function genInvStr(inv) {
    let str = '\n['
    if (inv.defenderReward.countedItems.length > 0) str += inv.defenderReward.asString
    if (inv.defenderReward.countedItems.length > 0 && inv.attackerReward.countedItems.length > 0) str += ' / '  
    if (inv.attackerReward.countedItems.length > 0) str += inv.attackerReward.asString
    str += ']'
    return str
}