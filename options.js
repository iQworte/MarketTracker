chrome.tabs.query({url: 'chrome-extension://'+chrome.runtime.id+'/options.html'}, (tabs)=> {
    if (tabs.length > 1) {
        tabs.forEach((tab, i)=> {
            if (i == 0) return
            else chrome.tabs.remove(tab.id)
        })
    }
})

var settings = {},
    timersID = [],
    actions = [],
    buys = [],
    orderHistory = [],
    checkLists = {},
    items = []

//Инициализация настроек расширения
document.addEventListener('DOMContentLoaded', async (event)=> {
    await initializeConfig()
    await loadListInputs()
    await loadSettings()
    loadNews()
    loadCheckLists()
    checkStatus(chrome.extension.getBackgroundPage().connected)

    //Детект изменения настроек
    chrome.storage.onChanged.addListener((changes, namespace)=> {
        for (let key in changes) {
            let storageChange = changes[key]
            if (key == 'orderHistory') orderHistory = storageChange.newValue
            else if (key == 'buys') buys = storageChange.newValue
            else if (key == 'checkLists') {
                checkLists = storageChange.newValue
                loadCheckLists()
            }
        }
    })

    //Поиск сетов
    let searchSetBtn = document.querySelector('#startSetsSearch')
    searchSetBtn.addEventListener('click', async ()=> {
        if (searchSetBtn.classList.contains('wait')) return
        searchSetBtn.classList.add('wait')
        searchSetBtn.textContent = 'Подождите...'

        selectSetsSort.setAttribute('disabled', 'disabled')
        selectSetsSort.value = 'a-z'
        document.querySelector('#tableSets .body').textContent = ''
        document.querySelector('#tableSets').style.display = 'none'
        document.querySelector('#nullTableSets').removeAttribute('style')

        letsCheckSets(items, 0, [])
        document.querySelector('#searchSetsPB').style.display = 'block'
        document.querySelector('#nullTableSets').textContent = 'Идет поиск комплектов...'
    })

    //Модалки
    let closeModalBtns = document.querySelectorAll('#modals .modal .head button')
    closeModalBtns.forEach((btn)=> {
        btn.addEventListener('click', ()=> {
            btn.parentElement.parentElement.classList.remove('active')
            document.querySelector('#modals .overlay.active').classList.remove('active')
        })
    })

    document.querySelector('#modals .overlay').addEventListener('click', ()=> {
        let activeModal = document.querySelector('#modals .modal.active')
        activeModal.style.transform = 'scale(1.1)'
        setTimeout(()=> activeModal.removeAttribute('style'), 100)
    })

    //Черный список
    document.querySelector('#formBlackList').addEventListener('submit', (e)=> {
        e.preventDefault()
        let name = document.querySelector('[list="inputBlackList"]').value.trim()
        if (name == '') return
        if (settings.platinum.blackList.some((el)=> el.name == name)) {
            document.querySelector('[list="inputBlackList"]').value = ''
            return
        }
        let id = genRndStr(24)
        while (settings.platinum.blackList.some((el)=> el.id == id)) {
            id = genRndStr(24)
        }
        let obj = { name: name, id: id }
        settings.platinum.blackList.push(obj)
        setValue('settings', settings)
        addInBlackList(obj)
        document.querySelector('[list="inputBlackList"]').value = ''
    })

    //Выставление нового предмета
    document.querySelector('#formNewItem').addEventListener('submit', async (e)=> {
        e.preventDefault()
        if (document.querySelector('#formNewItem button').classList.contains('wait')) return
        document.querySelector('#formNewItem button').classList.add('wait')
        let name = document.querySelector('#inputNewItem').getAttribute('data-value')
        if (name == '' || !items.some((el)=> el.url_name == name)) {
            document.querySelector('#formNewItem button').classList.remove('wait')
            return
        }
    
        let item
        let response = await fetch('https://api.warframe.market/v1/items/'+name)
        let data = await response.json()
        data.payload.item.items_in_set.forEach((el)=> {
            if (el.id == data.payload.item.id) item = el
        })
        
        let soldsHist = await requestSold(name)
        if (typeof item.mod_max_rank !== 'undefined') {
            soldsHist = soldsHist.filter((el)=> el.mod_rank == 0)
        } else if (typeof item.subtypes !== 'undefined') {
            soldsHist = soldsHist.filter((el)=> el.subtype == item.subtypes[0])
        }
        
        let startInd = (soldsHist.length >= 5) ? soldsHist.length-5 : 0
        soldsHist = soldsHist.slice(startInd, soldsHist.length)
        let avgPrice = getAvgPrice(soldsHist)/soldsHist.length
        let maxPrice = getMaxPrice(soldsHist)
        if (avgPrice == 0) {
            document.querySelector('#formNewItem button').classList.remove('wait')
            return
        }
        let price = Math.round((maxPrice-avgPrice)/2+avgPrice)

        let id = genRndStr(24)
        while (buys.some((el)=> el.id == id)) {
            id = genRndStr(24)
        }
        let date = new Date()
        let time = date.toLocaleString('ru-US')
        let icon = (item.sub_icon == null) ? item.thumb : item.sub_icon
        let obj = {
            id: id,
            order_id: '',
            item_id: item.id,
            item_name: item.ru.item_name,
            item_img: icon,
            item_url: item.url_name,
            price: price,
            quantity: 1,
            market_price_date: time
        }
        if (typeof item.mod_max_rank !== 'undefined') {
            obj.rank = 0
            obj.max_rank = item.mod_max_rank
        } else if (typeof item.subtypes !== 'undefined') {
            obj.subtype = item.subtypes[0]
            obj.subtypes = item.subtypes
        }

        let added = false
        buys.forEach((el, i)=> {
            if (added) return
            if (el.item_url == obj.item_url) {
                if (typeof el.rank !== 'undefined') {
                    if (el.rank == obj.rank) added = true
                } else if (typeof el.subtype !== 'undefined') {
                    if (el.subtype == obj.subtype) added = true
                } else {
                    added = true
                }
            }
        })

        if (added) {
            document.querySelector('#formNewItem button').classList.remove('wait')
            return
        }
        addInTableBuys(obj)
        buys.push(obj)
        await setValue('buys', buys)
        document.querySelector('#inputNewItem').value = ''
        document.querySelector('#inputNewItem').removeAttribute('data-value')
        document.querySelector('#formNewItem button').classList.remove('wait')
    })

    //Синхронизация с марктом
    let syncBtn = document.querySelector('#syncOrderList')
    syncBtn.addEventListener('click', async ()=> {
        if (syncBtn.classList.contains('wait')) return
        syncBtn.classList.add('wait')
        syncBtn.textContent = 'Подождите...'
        
        let syncedItems = [...buys]
        let userOrders = await getUserOrders()
        userOrders.forEach((order)=> {
            let id = genRndStr(24)
            while (buys.some((el)=> el.id == id)) {
                id = genRndStr(24)
            }
            let date = new Date()
            let time = date.toLocaleString('ru-US')
            let icon = (order.item.sub_icon == null) ? order.item.thumb : order.item.sub_icon
            let obj = {
                id: id,
                order_id: order.id,
                item_id: order.item.id,
                item_name: order.item.ru.item_name,
                item_img: icon,
                item_url: order.item.url_name,
                price: order.platinum,
                quantity: order.quantity,
                market_price_date: time
            }
            if (typeof order.mod_rank !== 'undefined') {
                obj.rank = order.mod_rank
                obj.max_rank = order.item.mod_max_rank
            } else if (typeof order.subtype !== 'undefined') {
                obj.subtype = order.subtype
                obj.subtypes = order.item.subtypes
            }

            //Проверка на те предметы, что уже есть на маркете но нет в приложение
            let added = false
            buys.forEach((el)=> {
                if (added) return
                if (el.item_url == obj.item_url) {
                    if (typeof el.rank !== 'undefined') {
                        if (el.rank == obj.rank) added = true
                    } else if (typeof el.subtype !== 'undefined') {
                        if (el.subtype == obj.subtype) added = true
                    } else {
                        added = true
                    }
                }
            })

            if (!added) {
                addInTableBuys(obj)
                buys.push(obj)
            }

            //Проверка на те предметы, что есть в приложение и находятся в статусе продажи, но их нет на маркете
            syncedItems.forEach((el, i)=> {
                if (el.order_id == '') syncedItems.splice(i, 1)
                if (el.item_url == obj.item_url) {
                    if (typeof el.rank !== 'undefined') {
                        if (el.rank == obj.rank) syncedItems.splice(i, 1)
                    } else if (typeof el.subtype !== 'undefined') {
                        if (el.subtype == obj.subtype) syncedItems.splice(i, 1)
                    } else {
                        syncedItems.splice(i, 1)
                    }
                }
            })
        })

        //Проверка на те предметы, что есть в приложение и находятся в статусе продажи, но их нет на маркете
        syncedItems.forEach((uns)=> {
            buys.forEach((el, i)=> {
                if (el.item_url != uns.item_url) return  
                if (typeof el.rank !== 'undefined') {
                    if (el.rank == uns.rank) buys[i].order_id = ''
                } else if (typeof el.subtype !== 'undefined') {
                    if (el.subtype == uns.subtype) buys[i].order_id = ''
                } else {
                    buys[i].order_id = ''
                }

                document.querySelector('#platinumBuys-'+el.id+' .btn.sell').style.display = 'none'
                document.querySelector('#platinumBuys-'+el.id+' .btn.put').classList.remove('onSale')
                document.querySelector('#platinumBuys-'+el.id+' .btn.put').textContent = 'Выставить'
            })
        })
        
        await setValue('buys', buys)
        syncBtn.classList.remove('wait')
        syncBtn.textContent = 'Синхронизировать'
    })

    //Очистка истории
    document.querySelectorAll('.clearHist').forEach((btn)=> {
        btn.addEventListener('click', ()=> {
            btn.textContent = 'Очищено!'
            btn.classList.add('active')
            if (btn.id == 'clearPlatinumTable') {
                orderHistory = orderHistory.filter((el)=> {
                    if (el.module != 'platinum') return el
                })
                setValue('orderHistory', orderHistory)
                document.querySelector('#tablePlatinum .body').textContent = ''
                document.querySelector('#tablePlatinum').style.display = 'none'
                document.querySelector('#nullTablePlatinum').style.display = 'block'
            } else if (btn.id == 'clearPlatinumBuysTable') {
                setValue('orderHistory', orderHistory)
                setValue('buys', [])
                document.querySelector('#tablePlatinumBuys .body').textContent = ''
                document.querySelector('#tablePlatinumBuys').style.display = 'none'
                document.querySelector('#nullTablePlatinumBuys').style.display = 'block'
            }
            setTimeout(()=> {
                btn.textContent = 'Очистить'
                btn.classList.remove('focus')
            }, 2000)
        })
    })

    //Открытие модалок
    document.querySelector('#actionsListBtn').addEventListener('click', ()=> toggleModal('actionsListModal'))
    document.querySelector('#blackListBtn').addEventListener('click', ()=> toggleModal('blackListModal'))
    document.querySelector('#openSettModal').addEventListener('click', ()=> toggleModal('settModal'))

    //Переключение вкладок
    let navButtons = document.querySelectorAll('[data-tab-button]')
    let tabs = document.querySelectorAll('.tab')
    navButtons.forEach((button)=> {
        button.addEventListener('click', ()=> {
            if (button.classList.contains('active')) return
            tabs.forEach((tab)=> tab.classList.remove('active'))
            document.querySelector('.tab[data-tab-name='+button.getAttribute('data-tab-button')+']').classList.add('active')
            navButtons.forEach((btn)=> btn.classList.remove('active'))
            button.classList.add('active')
        })
    })

    //Громкость оповещений
    let notifVolume = document.querySelector('#notifVolume')
    notifVolume.addEventListener('change', ()=> {
        settings.notifVolume = notifVolume.value
        let num = getRandomInteger(1, 2)
        let notifName
        if (num == 1) notifName = 'NewsChecker'
        else if (num == 2) notifName = 'PlatinumChecker'
        let audio = new Audio('audio/notif_'+notifName+'.mp3')
        audio.volume = settings.notifVolume
        audio.play()
    })

    //Сохранение настроек
    let inputs = document.querySelectorAll('input')
    inputs.forEach((input)=> {
        input.addEventListener('input', async ()=> {
            if (!Object.keys(settings).length || input.getAttribute('list') == 'inputBlackList') return
            if (input.id == 'checkListText' || input.id == 'buyedSubtype' || input.id == 'buyedRank' || input.id == 'buyedPrice' || input.id == 'buyedQuantity' || input.id == 'notifVolume') return
            if (input.classList.contains('marketPriceInput') || input.classList.contains('marketQuantityInput') || input.classList.contains('marketRankInput')) return
            if (input.id == 'notifActive') {
                settings.notifActive = input.checked
            } else if (input.id == 'animation') {
                settings.animation = input.checked
            } else if (input.id == 'inject') {
                settings.inject = input.checked
            } else {
                let getTab = document.querySelector('.tab.active').getAttribute('data-tab-name')
                if (input.parentElement.hasAttribute('data-drop-point')) {
                    settings[getTab][input.parentElement.getAttribute('data-drop-point')][input.id] = (input.value == 'on' || input.value == 'off') ? input.checked : input.value
                } else if (input.parentElement.parentElement.parentElement.hasAttribute('data-drop-point')) {
                    settings[getTab][input.parentElement.parentElement.parentElement.getAttribute('data-drop-point')][input.id] = (input.value == 'on' || input.value == 'off') ? input.checked : input.value
                } else {
                    if (input.id == '' || input.id.includes('day') || input.id.includes('week')) return
                    settings[getTab][input.id] = (input.value == 'on' || input.value == 'off') ? input.checked : input.value
                }
            }
            await setValue('settings', settings)
        })
    })

    //Дроп листы
    let dropLists = document.querySelectorAll('.drop-list .arrow')
    dropLists.forEach((dropList)=> {
        dropList.addEventListener('click', ()=> {
            if (!dropList.classList.contains('drop')) {
                dropLists.forEach((dropList)=> {
                    dropList.classList.remove('drop')
                })
            }
            dropList.classList.toggle('drop')
        })
    })

    //Статус на сайте
    let selected = document.querySelector('.selected')
    let choose = document.querySelector('.choose')
    selected.parentElement.addEventListener('click', ()=> {
        choose.classList.toggle('active')
        selected.classList.toggle('active')
    })
    document.querySelectorAll('.choose > div').forEach((el)=> {
        el.addEventListener('click', ()=> {
            el.parentElement.classList.remove('active')
            selected.classList.remove('active')
            if (selected.classList.contains(el.getAttribute('class'))) return
            chrome.extension.getBackgroundPage().wasStatusMod = true
            chrome.extension.getBackgroundPage().socket.send('{"type":"@WS/USER/SET_STATUS","payload":"'+el.getAttribute('class')+'"}')
        })
    })
    selected.classList.add(chrome.extension.getBackgroundPage().status)
    selected.textContent = choose.querySelector('.'+chrome.extension.getBackgroundPage().status).textContent

    //Сортировка найденных сетов
    let selectSetsSort = document.querySelector('#selectSetsSort')
    selectSetsSort.addEventListener('input', ()=> {
        let it = document.querySelectorAll('#tableSets .body > div')
        let tempArr = []
        if (selectSetsSort.value == 'a-z') {
            it.forEach((item)=> {
                let obj = {
                    el: item,
                    name: item.querySelector('a').textContent
                }
                tempArr.push(obj)
            })
            tempArr.sort((a, b)=> {
                if (a.name < b.name) return -1
                if (a.name > b.name) return 1
                return 0
            })
        } else if (selectSetsSort.value == 'diff') {
            it.forEach((item)=> {
                let diff = item.querySelector('div:nth-child(5)').textContent.split(' ')
                let obj = {
                    el: item,
                    diff: Number(diff[0])
                }
                tempArr.push(obj)
            })
            tempArr.sort((a, b)=> {
                return b.diff-a.diff
            })
        } else if (selectSetsSort.value == 'parts') {
            it.forEach((item)=> {
                let parts = item.querySelector('div:nth-child(4)').textContent.split(' ')
                let obj = {
                    el: item,
                    parts: Number(parts[0])
                }
                tempArr.push(obj)
            })
            tempArr.sort((a, b)=> {
                return a.parts-b.parts
            })
        }
        document.querySelector('#tableSets .body').textContent = ''
        tempArr.forEach((item)=> document.querySelector('#tableSets .body').append(item.el))
    })

    //Обновление текущих рыночных цен
    let updateMarketPrices = document.querySelector('#updateMarketPrices')
    updateMarketPrices.addEventListener('click', async ()=> {
        if (updateMarketPrices.classList.contains('wait')) return
        let blocked = [...document.querySelectorAll('#tablePlatinumBuys .body .remove'), ...document.querySelectorAll('#tablePlatinum .body .buy'), ...document.querySelectorAll('#tablePlatinumBuys .body .sell'), ...document.querySelectorAll('#tablePlatinumBuys .body .put'), ...document.querySelectorAll('#tablePlatinumBuys input'), ...document.querySelectorAll('#tablePlatinumBuys select')]
        blocked.forEach((el)=> el.setAttribute('disabled', 'disabled'))
        updateMarketPrices.classList.add('wait')
        updateMarketPrices.textContent = 'Подождите...'
        let marketPrices = document.querySelectorAll('.marketPrice')
        if (marketPrices.length == 0) {
            updateMarketPrices.classList.remove('wait')
            updateMarketPrices.textContent = 'Обновить цены'
            blocked.forEach((el)=> el.removeAttribute('disabled'))
            return
        }
        await updPrices(marketPrices)
        updateMarketPrices.classList.remove('wait')
        updateMarketPrices.textContent = 'Обновить цены'
        blocked.forEach((el)=> el.removeAttribute('disabled'))
        await setValue('buys', buys)
    })

    //Добавление в чел-лист
    document.querySelector('#checkList').addEventListener('submit', (e)=> {
        e.preventDefault()
        let text = document.querySelector('#checkListText').value.trim()
        let type = document.querySelector('#checkListType').value
        if (text == '') return
        checkLists[type].push({checked: false, text: text})
        setValue('checkLists', checkLists)
        document.querySelector('#checkListText').value = ''
        loadCheckLists()
    })

    //Событие принятия runtime
    chrome.runtime.onMessage.addListener(async (request, sender, sendResponse)=> {
        sendResponse({farewell: "Ok"})
        if (request.action == 'buy') addInTable(request.order)
        else if (request.action == 'check') addInActivity(request.message)
        else if (request.action == 'status') checkStatus(request.status)
        else if (request.action == 'update_news') loadNews()
        else if (request.action == 'set_status') {
            selected.textContent = choose.querySelector('.'+request.status).textContent
            selected.classList.remove('ingame', 'online', 'invisible')
            selected.classList.add(request.status)
        } else if (request.action == 'update_prices') {
            if (typeof request.process !== 'undefined') {
                let blocked = [...document.querySelectorAll('#tablePlatinumBuys .body .remove'), ...document.querySelectorAll('#tablePlatinum .body .buy'), ...document.querySelectorAll('#tablePlatinumBuys .body .sell'), ...document.querySelectorAll('#tablePlatinumBuys .body .put'), ...document.querySelectorAll('#tablePlatinumBuys input'), ...document.querySelectorAll('#tablePlatinumBuys select')]
                if (request.process == true) {
                    blocked.forEach((el)=> el.removeAttribute('disabled'))
                    updateMarketPrices.classList.add('wait')
                    updateMarketPrices.textContent = 'Подождите...'
                    let marketPrices = document.querySelectorAll('.marketPrice')
                    marketPrices.forEach(async (el, i)=> el.textContent = 'Обновление...')
                } else {
                    blocked.forEach((el)=> el.removeAttribute('disabled'))
                    updateMarketPrices.classList.remove('wait')
                    updateMarketPrices.textContent = 'Обновить цены'
                }
            } else if (typeof request.index !== 'undefined') {
                let buysDivs = document.querySelectorAll('#tablePlatinumBuys .body > div')
                let dateArr = buys[buys.length-request.index-1].market_price_date.split(',')
                buysDivs[request.index].querySelector('.marketPriceInput').value = buys[buys.length-request.index-1].price
                buysDivs[request.index].querySelector('.marketPrice').textContent = ''
                buysDivs[request.index].querySelector('.marketPrice').append(buys[buys.length-request.index-1].price+' пл.')
                buysDivs[request.index].querySelector('.marketPrice').append(document.createElement('br'))
                buysDivs[request.index].querySelector('.marketPrice').append(document.createElement('br'))
                buysDivs[request.index].querySelector('.marketPrice').append(dateArr[0]+',')
                buysDivs[request.index].querySelector('.marketPrice').append(document.createElement('br'))
                buysDivs[request.index].querySelector('.marketPrice').append(dateArr[1])
            }
        }
    })
})

async function initializeConfig() {
    actions = await getValue('actions')
    buys = await getValue('buys')
    orderHistory = await getValue('orderHistory')
    checkLists = await getValue('checkLists')
    settings = await getValue('settings')
    if (actions == null) actions = []
    if (buys == null) buys = []
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

async function loadSettings() {
    //Platinum
    for (key in settings.platinum) {
        if (key != 'blackList') {
            if (document.getElementById(key).type == 'checkbox') {
                document.getElementById(key).checked = settings.platinum[key]
            } else if (document.getElementById(key).type == 'number') {
                document.getElementById(key).value = settings.platinum[key]
            }
        }
    }
    
    //News
    for (key in settings.news) {
        if (typeof settings.news[key] == 'object') {
            for (iKey in settings.news[key]) {
                document.getElementById(iKey).checked = settings.news[key][iKey]
            }
        } else {
            document.getElementById(key).checked = settings.news[key]
        }
    }

    //Other
    document.getElementById('notifVolume').value = settings.notifVolume
    document.getElementById('notifActive').checked = settings.notifActive
    document.getElementById('animation').checked = settings.animation
    document.getElementById('inject').checked = settings.inject

    orderHistory.forEach((el)=> addInTable(el))
    buys.forEach((el)=> addInTableBuys(el))
    settings.platinum.blackList.forEach((el)=> addInBlackList(el))
    actions.forEach((el)=> addInActionsList(el))
}

function loadCheckLists() {
    for (key in checkLists) {
        if (key == 'week_last_reset' || key == 'day_last_reset') continue
        document.querySelector('.'+key).textContent = ''
        if (checkLists[key].length == 0) continue
        let mainDiv = document.createElement('div')
        let progBar = document.createElement('div')
        progBar.classList.add('progBar')
        progBar.style.background = '#fd6d6d'
        let progBar2 = document.createElement('div')
        progBar2.classList.add('progBar')
        progBar2.style.background = '#6de483'
        let head = document.createElement('h5')
        head.classList.add('head')
        if (key == 'day') head.textContent = 'Ежедневные'
        else if (key == 'week') head.textContent = 'Еженедельные'
        let block = document.createElement('div')
        block.classList.add('check-block')
        let progCompl = 0
        checkLists[key].forEach((el, i)=> {
            progCompl = (el.checked) ? progCompl+1 : progCompl
            let elemDiv = document.createElement('div')
            let text = document.createElement('span')
            text.textContent = (i+1)+'. '+el.text
            let checkBox = document.createElement('input')
            checkBox.type = 'checkbox'
            checkBox.id = key+'-'+i
            checkBox.checked = el.checked
            checkBox.addEventListener('change', ()=> {
                checkLists[checkBox.id.split('-')[0]][i].checked = checkBox.checked
                setValue('checkLists', checkLists)
                let pc = (checkBox.checked) ? Number(progBar2.getAttribute('progCompl'))+1 : Number(progBar2.getAttribute('progCompl'))-1
                progBar2.setAttribute('progCompl', pc)
                progBar2.style.width = 'calc('+100/checkLists[checkBox.id.split('-')[0]].length*pc.toFixed(2)+'% + 7px)'
            })
            checkBoxL = document.createElement('label')
            checkBoxL.setAttribute('for', key+'-'+i)
            elemDiv.append(text)
            elemDiv.append(checkBox)
            elemDiv.append(checkBoxL)
            block.append(elemDiv)
        })
        progBar2.setAttribute('progCompl', progCompl)
        progBar2.style.width = 'calc('+100/checkLists[key].length*progCompl.toFixed(2)+'% + 7px)'
        progBar.append(progBar2)
        block.prepend(progBar)
        mainDiv.append(head)
        mainDiv.append(block)
        document.querySelector('.'+key).append(mainDiv)
    }
}

function genRndStr(i) {
    let abc = 'abcdefghijklmnopqrstuvwxyz0123456789'
    let str = ''
    while (str.length < i) {
        str += abc[Math.floor(Math.random() * abc.length)]
    }
    return str
}

function addInBlackList(item) {
    let divItem = document.createElement('div')
    let name = document.createElement('div')
    name.textContent = '['+item.name+']'
    divItem.append(name)
    let btn = document.createElement('button')
    btn.classList.add('removeBtn')
    btn.addEventListener('click', ()=> {
        divItem.remove()
        if (document.querySelectorAll('#blackList .body > div').length == 0) {
            document.querySelector('#blackList').style.display = 'none'
            document.querySelector('#nullBlackList').removeAttribute('style')
        }
        settings.platinum.blackList.forEach((el, i)=> {
            if (el.id == item.id) settings.platinum.blackList.splice(i, 1)
        })
        setValue('settings', settings)
    })
    divItem.append(btn)
    document.querySelector('#blackList').removeAttribute('style')
    document.querySelector('#nullBlackList').style.display = 'none'
    document.querySelector('#blackList .body').append(divItem)
}

function addInActionsList(item) {
    let divItem = document.createElement('div')
    let name = document.createElement('div')
    name.textContent = '['+item.name+']'
    divItem.append(name)
    let platinum = document.createElement('div')
    platinum.textContent = (item.platinum > 0) ? '+'+item.platinum : item.platinum
    let color = (item.platinum > 0) ? 'green' : 'red'
    platinum.classList.add(color)
    divItem.append(platinum)
    let date = document.createElement('div')
    date.textContent = item.date
    divItem.append(date)
    let btn = document.createElement('button')
    btn.classList.add('removeBtn')
    btn.addEventListener('click', ()=> {
        divItem.remove()
        if (document.querySelectorAll('#actionsList .body > div').length == 0) {
            document.querySelector('#actionsList').style.display = 'none'
            document.querySelector('#nullActionsList').removeAttribute('style')
        }
        actions.forEach((el, i)=> {
            if (el.id == item.id) actions.splice(i, 1)
        })
        setValue('actions', actions)
    })
    divItem.append(btn)
    document.querySelector('#actionsList').removeAttribute('style')
    document.querySelector('#nullActionsList').style.display = 'none'
    document.querySelector('#actionsList .body').prepend(divItem)
}

function toggleModal(id) {
    document.querySelector('#modals .overlay').classList.toggle('active')
    document.querySelector('#'+id).classList.toggle('active')
}

async function wait(ms) {
    return new Promise((resolve)=> setTimeout(()=> resolve(), ms))
}

async function updPrices(arr, i = 0) {
    if (arr.length == i) return
    arr[i].textContent = 'Обновление...'
    let soldsHist = await requestSold(buys[buys.length-i-1].item_url)
    if (typeof buys[buys.length-i-1].rank !== 'undefined') {
        soldsHist = soldsHist.filter((elem)=> elem.mod_rank == buys[buys.length-i-1].rank)
    } else if (typeof buys[buys.length-i-1].subtype !== 'undefined') {
        soldsHist = soldsHist.filter((elem)=> elem.subtype == buys[buys.length-i-1].subtype)
    }

    let startInd = (soldsHist.length >= 5) ? soldsHist.length-5 : 0
    soldsHist = soldsHist.slice(startInd, soldsHist.length)
    let avgPrice = getAvgPrice(soldsHist)/soldsHist.length
    let maxPrice = getMaxPrice(soldsHist)
    let price = (avgPrice == 0) ? 0 : Math.round((maxPrice-avgPrice)/2+avgPrice)
    if (buys[buys.length-i-1].price != price && price != 0) {
        document.querySelector('#platinumBuys-'+buys[buys.length-i-1].id+' .marketPriceInput').value = price
        if (buys[buys.length-i-1].order_id != '') await editItemToMarket({ id: buys[buys.length-i-1].id, order_id: buys[buys.length-i-1].order_id, price: price, quantity: buys[buys.length-i-1].quantity, rank: buys[buys.length-i-1].rank, subtype: buys[buys.length-i-1].subtype })  
        else buys[buys.length-i-1].price = price
    }
    if (price != 0) {
        let date = new Date()
        let time = date.toLocaleString('ru-US')
        buys[buys.length-i-1].market_price_date = time
        await setValue('buys', buys)
        arr[i].textContent = ''
        arr[i].append(buys[buys.length-i-1].price+' пл.')
        arr[i].append(document.createElement('br'))
        arr[i].append(document.createElement('br'))
        let dateArr = time.split(',')
        arr[i].append(dateArr[0]+',')
        arr[i].append(document.createElement('br'))
        arr[i].append(dateArr[1])
    }
    await wait(500)
    return await updPrices(arr, ++i)
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

async function getUserOrders() {
    let docMarket = await parseURL('https://warframe.market/settings')
    let userData = JSON.parse(docMarket.getElementById('application-state').textContent).current_user
    let nick = userData.ingame_name
    return new Promise((resolve)=>{
        fetch('https://api.warframe.market/v1/profile/'+nick+'/orders')
        .then((response)=> {
            response.json()
            .then(async (data)=> {
                resolve(data.payload.sell_orders)
            })
        })
    })
}

async function letsCheckSets(items, i, setsArr) {
    if (i == items.length) {
        finalSetCheck(setsArr, 0)
        return
    }
    let width = ((i+1)/items.length*100).toFixed(2)
    document.querySelector('#searchSetsPB > div').style.width = width+'%'

    let strParts = items[i].url_name.split('_')
    if (strParts[strParts.length-1] != 'set') {
        letsCheckSets(items, ++i, setsArr)
        return
    }

    let itemInfo = await getItemInfo(items[i].url_name)
    if (itemInfo.payload.item.items_in_set.length == 1) {
        await wait(500)
        letsCheckSets(items, ++i, setsArr)
        return
    }

    let setItemsArr = itemInfo.payload.item.items_in_set.filter((el)=> {
        return checkTagsArr(el)
    })

    setsArr.push({set_item: items[i], set_arr: setItemsArr})    

    await wait(500)
    letsCheckSets(items, ++i, setsArr)
}

async function finalSetCheck(setsArr, i) {
    if (i == setsArr.length) {
        let searchSetBtn = document.querySelector('#startSetsSearch')
        searchSetBtn.classList.remove('wait')
        searchSetBtn.textContent = 'Поиск'
        document.querySelector('#searchSetsPB').removeAttribute('style')
        document.querySelector('#nullTableSets').style.display = 'none'
        selectSetsSort.removeAttribute('disabled')
        return
    }
    document.querySelector('#nullTableSets').textContent = 'Идет сканирование: '+(i+1)+'/'+setsArr.length
    let width = ((i+1)/setsArr.length*100).toFixed(2)
    document.querySelector('#searchSetsPB > div').style.width = width+'%'

    let soldsHist = await requestSold(setsArr[i].set_item.url_name)
    let startInd = (soldsHist.length >= 5) ? soldsHist.length-5 : 0
    soldsHist = soldsHist.slice(startInd, soldsHist.length)
    let avgPrice = getAvgPrice(soldsHist)/soldsHist.length
    let maxPrice = getMaxPrice(soldsHist)
    if (avgPrice == 0) return
    let price = Math.round((maxPrice-avgPrice)/2+avgPrice)
    if (price != price) {
        finalSetCheck(setsArr, ++i)
        return
    }

    let kitInPartsPrice = await checkSetItems(setsArr[i].set_arr)
    if (kitInPartsPrice != kitInPartsPrice) {
        finalSetCheck(setsArr, ++i)
        return
    }
    addInSetsTable(setsArr[i].set_item, price, kitInPartsPrice, setsArr[i].set_arr.length)
    finalSetCheck(setsArr, ++i)
}

function checkOrders(orders) {
    if (orders.length > 10) {
        let flag = true
        while (flag) {
            if (typeof orders[0].mod_rank !== 'undefined') {
                if (orders[0].mod_rank != orders[1].mod_rank) {
                    flag = false
                }
            }
            if (flag) {
                if (orders[1].platinum/orders[0].platinum*100-100 >= 30) orders.splice(0, 1)
                else flag = false
            }
        }
    }
    return orders
}

function checkSetItems(arr) {
    let kitInPartsPrice = 0
    return new Promise((resolve)=> {
        checkItem(arr, 0)
        async function checkItem(arr, x) {
            if (x == arr.length) {
                resolve(kitInPartsPrice)
                return
            }

            let soldsHist = await requestSold(arr[x].url_name)
            let startInd = (soldsHist.length >= 5) ? soldsHist.length-5 : 0
            soldsHist = soldsHist.slice(startInd, soldsHist.length)
            let avgPrice = getAvgPrice(soldsHist)/soldsHist.length
            let maxPrice = getMaxPrice(soldsHist)
            if (avgPrice == 0) return
            let price = Math.round((maxPrice-avgPrice)/2+avgPrice)
            
            let quantity = (typeof arr[x].quantity_for_set !== 'undefined') ? arr[x].quantity_for_set : 1
            kitInPartsPrice += price*quantity
            await wait(500)
            checkItem(arr, ++x)
        }
    })
}

function checkTagsArr(arr) {
    let res = true
    arr.tags.forEach((tag)=> {
        if (tag == 'set') res = false
    })
    return res
}

function getItemInfo(item) {
    return new Promise((resolve)=> {
        fetch('https://api.warframe.market/v1/items/'+item)
        .then((response)=> {
            resolve(response.json())
        })
    })
}

function getItemOrders(item) {
    return new Promise((resolve)=>{
        fetch('https://api.warframe.market/v1/items/'+item+'/orders')
        .then((response)=> {
            response.json()
            .then(async (data)=> {
                data.payload.orders = data.payload.orders.filter((el)=> {
                    if (el.visible) return el
                })
                data.payload.orders.sort((a, b)=> {
                    if ((a.user.status == 'offline') != (b.user.status == 'offline')) {
                        return a.user.status != 'offline' ? -1 : 1
                    }
                    if ((a.order_type === 'buy') != (b.order_type === 'buy')) {
                        return a.order_type === 'buy' ? 1 : -1
                    }
                    return a.platinum - b.platinum
                })
                resolve(data.payload.orders)
            })
        })
    })
}

function checkStatus(status) {
    if (status) {
        document.querySelector('.status span').classList.remove('broken')
        document.querySelector('.status span').classList.add('healthy')
        document.querySelector('.status div').textContent = 'Подключено'
    } else {
        document.querySelector('.status span').classList.remove('healthy')
        document.querySelector('.status span').classList.add('broken')
        document.querySelector('.status div').textContent = 'Ошибка соединения'
    }
}

async function setValue(key, value, updateStatus) {
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

function getRandomInteger(min, max) {
    min = Math.ceil(min)
    max = Math.floor(max)
    return Math.floor(Math.random()*(max-min+1))+min
}

function getRandomFloat(min, max) {
    return min + Math.random()*(max-min)
}

function addLeadZero(val) {
    if (+val < 10) return '0'+val
    return val
}

function pluris(number, titles) {  
    cases = [2, 0, 1, 1, 1, 2]
    return titles[ (number%100>4 && number%100<20)? 2 : cases[(number%10<5)?number%10:5] ]
}

function timerGo(id, end_date_str) {
    let timerId = setInterval(startTimer, 1000)
    timersID.push(timerId)

    function startTimer() {
        if (!document.getElementById(id)) {
            clearInterval(timerId)
            return
        }
        let now = new Date()
        let date
        if (end_date_str == 'monday') {
            let m = new Date()
            if (now.getDay()) m.setDate(now.getDate() + 8 - now.getDay())
            else m.setDate(now.getDate() + 1)
            m.setUTCHours(0, 0, 0, 0)
            date = m
        } else {
            date = new Date(end_date_str)
        }

        let ms_left = date-now
        if (ms_left <= 0) {
            document.getElementById(id).textContent = 'Истекло'
            document.getElementById(id).classList.add('redTimer')
        } else {
            let res = new Date(ms_left)

            var year = res.getUTCFullYear() - 1970+'г '
            if (res.getUTCFullYear() - 1970 == 0) var year = ''
            var month = res.getUTCMonth()+'м '
            if (res.getUTCMonth() == 0) var month = ''
            var days = res.getUTCDate() - 1+'д '
            if (res.getUTCDate() - 1 == 0) var days = ''
            var hours = res.getUTCHours()+'ч '
            if (res.getUTCHours() == 0) var hours = ''
            var minutes = res.getUTCMinutes()+'м '
            if (res.getUTCMinutes() == 0) var minutes = ''
            var seconds = res.getUTCSeconds()+'с '

            let str_timer = year+month+days+hours+minutes+seconds
            document.getElementById(id).textContent = str_timer

            if (ms_left <= 600000) document.getElementById(id).classList.add('redTimer')
        }
    }
}

async function loadListInputs() {
    let response = await fetch('https://api.warframe.market/v1/items', {'headers': {'language': 'ru'}})
    let data = await response.json()
    items = data.payload.items.sort((a, b)=> {
        if (a.item_name < b.item_name) return -1
        if (a.item_name > b.item_name) return 1
        return 0
    })

    items.forEach((el)=> {
        let option = document.createElement('option')
        option.value = el.item_name
        document.querySelector('#inputBlackList').append(option)
    })

    document.querySelector('#inputNewItem').addEventListener('input', ()=> {
        let input = document.querySelector('#inputNewItem').value.trim()
        document.querySelector('#inputNewItem').removeAttribute('data-value')
        let output = []
        items.forEach((el)=> {
            if (el.item_name.toLowerCase().indexOf(input.toLowerCase()) == -1 || output.length > 4) return
            output.push(el)
        })

        document.querySelectorAll('#outputNewItems div').forEach((el)=> el.remove())

        if (output.length > 0 && output[0].item_name.toLowerCase() == input.toLowerCase()) {
            document.querySelector('#inputNewItem').setAttribute('data-value', output[0].url_name)
            return
        }
        output.forEach((el)=> {
            let div = document.createElement('div')
            div.textContent = el.item_name
            div.addEventListener('click', ()=> {
                document.querySelector('#inputNewItem').value = el.item_name
                document.querySelector('#inputNewItem').setAttribute('data-value', el.url_name)
            })
            document.querySelector('#outputNewItems').append(div)
        })
    })
}

function addInActivity(src) {
    if (document.hidden || !settings.animation) return
    let box = document.createElement('div')
    box.style.webkitAnimationName = 'drop'
    let delayTime = getRandomFloat(0, 5)
    box.style.webkitAnimationDelay = delayTime+'s'
    let durationTime = getRandomFloat(13, 20)
    box.style.webkitAnimationDuration = durationTime+'s'
    let img = document.createElement('img')
    img.src = 'https://warframe.market/static/assets/'+src
    let rnd = getRandomInteger(0, 1)
    if (rnd == 0) img.style.left = getRandomInteger(0, 30)+'%'
    else img.style.right = getRandomInteger(0, 30)+'%'
    img.style.top = '-'+getRandomInteger(60, 100)+'px'
    img.style.webkitAnimationName = 'rotation'+getRandomInteger(1, 2)
    img.style.webkitAnimationDuration = getRandomFloat(4, 8)+'s'
    box.append(img)
    setTimeout(()=> box.remove(), (delayTime+durationTime)*1000)
    document.querySelector('#activity').append(box)
}

function addInSetsTable(set, price, priceOfParts, partsCount) {
    let divItem = document.createElement('div')
    let imgBox = document.createElement('div')
    imgBox.classList.add('img')
    let img = document.createElement('img')
    img.src = 'https://warframe.market/static/assets/'+set.thumb
    imgBox.append(img)
    divItem.append(imgBox)
    let divInfo = document.createElement('div')
    divInfo.classList.add('info')
    let a = document.createElement('a')
    a.href = 'https://warframe.market/ru/items/'+set.url_name
    a.target = '_blank'
    a.textContent = set.item_name
    divInfo.append(a)
    divItem.append(divInfo)

    let divPrice = document.createElement('div')
    divPrice.textContent = price+' пл.'

    let divPriceOfParts = document.createElement('div')
    divPriceOfParts.textContent = priceOfParts+' пл.'

    let divPartsCount = document.createElement('div')
    divPartsCount.textContent = partsCount+' шт.'

    let divBenefit = document.createElement('div')
    divBenefit.textContent = Math.abs(price-priceOfParts)+' пл.'

    let mainDiv = document.createElement('div')
    mainDiv.append(divItem)
    mainDiv.append(divPrice)
    mainDiv.append(divPriceOfParts)
    mainDiv.append(divPartsCount)
    mainDiv.append(divBenefit)
    document.querySelector('#tableSets').removeAttribute('style')
    document.querySelector('#tableSets .body').append(mainDiv)
}

function addInTable(order) {
    //Предмет
    let divItem = document.createElement('div')
    let imgBox = document.createElement('div')
    imgBox.classList.add('img')
    let imgItem = document.createElement('img')
    imgItem.src = 'https://warframe.market/static/assets/'+order.icon
    imgBox.append(imgItem)
    divItem.append(imgBox)
    let divInfo = document.createElement('div')
    divInfo.classList.add('info')
    let aItem = document.createElement('a')
    aItem.href = 'https://warframe.market/ru/items/'+order.url_name
    aItem.target = '_blank'
    aItem.textContent = order.name.ru
    divInfo.append(aItem)
    let qAnDp = document.createElement('div')
    qAnDp.textContent = order.price+' пл. | '+order.quantity+' шт.'
    divInfo.append(qAnDp)
    if (typeof order.rank !== 'undefined') {
        let rank = document.createElement('div')
        rank.classList.add('additions')
        rank.textContent = 'Ранг: '+order.rank+' / '+order.max_rank
        divInfo.append(rank)
    } else if (typeof order.subtype !== 'undefined') {
        let subtype = document.createElement('div')
        subtype.classList.add('additions')
        subtype.textContent = 'Подтип: '+order.subtype
        divInfo.append(subtype)
    }
    divItem.append(divInfo)

    //Выгода / Дукаты
    let divBen = document.createElement('div')
    divBen.textContent = order.benefit+' пл.'

    //Эффективность
    let divEff = document.createElement('div')
    divEff.textContent = (order.module == 'platinum') ? order.coeff+'%' : order.coeff+' дук.'
    
    //Продавец
    let divSeller = document.createElement('div')
    divSeller.textContent = '['+order.region+'] '
    let aSeller = document.createElement('a')
    aSeller.href = 'https://warframe.market/ru/profile/'+order.seller
    aSeller.target = '_blank'
    aSeller.textContent = order.seller
    divSeller.append(aSeller)   

    //Дата
    let divDate = document.createElement('div')
    divDate.textContent = order.date
    
    //Копировать
    let copyBtn = document.createElement('button')
    copyBtn.classList.add('btn')
    copyBtn.textContent = 'Написать'
    let text
    switch (order.region) {
        case 'EN':
            text = '/w '+order.seller+' Hi! I want to buy: "'+order.name[order.region.toLowerCase()]
            if (typeof order.rank !== 'undefined') text += ' (rank '+order.rank+')'
            text += '" for '+order.price+' platinum. (warframe.market)'
            break
        case 'RU':
            text = '/w '+order.seller+' Привет! я хочу купить: "'+order.name[order.region.toLowerCase()]
            if (typeof order.rank !== 'undefined') text += ' (ранг '+order.rank+')'
            text += '" за '+order.price+' '+pluris(order.price, ['платину', 'платины', 'платины'])+'. (warframe.market)'
            break
        case 'KO':
            text = '/w '+order.seller+' 님 안녕하세요! "'+order.name[order.region.toLowerCase()]
            if (typeof order.rank !== 'undefined') text += ' (rank '+order.rank+')'
            text += '" 을 '+order.price+'에 구매하고 싶습니다. (warframe.market)'
            break
        case 'FR':
            text = '/w '+order.seller+' Salut!je voudrais acheter: "'+order.name[order.region.toLowerCase()]
            if (typeof order.rank !== 'undefined') text += ' (rank '+order.rank+')'
            text += '" pour '+order.price+' platine. (warframe.market)'
            break
        case 'SV':
            text = '/w '+order.seller+' Tjenare! Jag skulle vilja köp: "'+order.name[order.region.toLowerCase()] 
            if (typeof order.rank !== 'undefined') text += ' (rank '+order.rank+')'
            text += '" för '+order.price+' platinum. (warframe.market)'
            break
        case 'DE':
            text ='/w '+order.seller+' Hallo, ich möchte folgendes kaufen: "'+order.name[order.region.toLowerCase()] 
            if (typeof order.rank !== 'undefined') text += ' (rank '+order.rank+')'
            text += '" für '+order.price+' Platin. (warframe.market)'
            break
    }
    copyBtn.addEventListener('click', ()=> {
        copyBtn.textContent = 'Скопировано!'
        copyBtn.classList.add('active')
        navigator.clipboard.writeText(text)
        setTimeout(()=> {
            copyBtn.textContent = 'Написать'
            copyBtn.classList.remove('active')
        }, 2000)
    })

    //Купил
    let buyBtn = document.createElement('button')
    buyBtn.classList.add('btn', 'buy')
    buyBtn.textContent = 'Купил'
    buyBtn.addEventListener('click', ()=> {
        document.querySelector('#buyModal .body').textContent = ''
        let formConfirmBuy = document.createElement('form')
        formConfirmBuy.id = 'confirmBuy'

        let divItem = document.createElement('div')
        divItem.textContent = order.name.ru
        formConfirmBuy.append(divItem)

        let divQuantity = document.createElement('div')
        divQuantity.classList.add('input-block')
        let inputQuantity = document.createElement('input')
        inputQuantity.type = 'number'
        inputQuantity.value = order.quantity
        inputQuantity.min = 1
        inputQuantity.max = 9999
        inputQuantity.placeholder = '1 - 9999'
        inputQuantity.id = 'buyedQuantity'
        divQuantity.append(inputQuantity)
        let labelQuantity = document.createElement('label')
        labelQuantity.for = 'buyedQuantity'
        labelQuantity.textContent = 'Количество предметов'
        divQuantity.append(labelQuantity)
        formConfirmBuy.append(divQuantity)

        let selectRank
        if (typeof order.rank !== 'undefined') {
            let divRank = document.createElement('div')
            divRank.classList.add('input-block')
            selectRank = document.createElement('select')
            selectRank.id = 'buyedRank'
            for (i = 0; i <= order.max_rank; i++) {
                let opt = document.createElement('option')
                opt.value = i
                opt.textContent = 'Ранг: '+i
                if (i == order.rank) opt.selected = 'selected'
                selectRank.append(opt)
            }
            divRank.append(selectRank)
            let labelRank = document.createElement('label')
            labelRank.for = 'buyedRank'
            labelRank.textContent = 'Ранг предмета'
            divRank.append(labelRank)
            formConfirmBuy.append(divRank)
        }

        let selectSubtype
        if (typeof order.subtype !== 'undefined') {
            let divSubtype = document.createElement('div')
            divSubtype.classList.add('input-block')
            selectSubtype = document.createElement('select')
            selectSubtype.id = 'buyedSubtype'
            order.subtypes.forEach((el)=> {
                let opt = document.createElement('option')
                opt.value = el
                opt.textContent = el
                if (i == order.subtype) opt.selected = 'selected'
                selectSubtype.append(opt)
            })
            divSubtype.append(selectSubtype)
            let labelSubtype = document.createElement('label')
            labelSubtype.for = 'buyedSubtype'
            labelSubtype.textContent = 'Подтип предмета'
            divSubtype.append(labelSubtype)
            formConfirmBuy.append(divSubtype)
        }

        let divPrice = document.createElement('div')
        divPrice.classList.add('input-block')
        let inputPrice = document.createElement('input')
        inputPrice.type = 'number'
        inputPrice.value = order.price
        inputPrice.min = 1
        inputPrice.max = 9999
        inputPrice.placeholder = '1 - 9999'
        inputPrice.id = 'buyedPrice'
        divPrice.append(inputPrice)
        let labelPrice = document.createElement('label')
        labelPrice.for = 'buyedPrice'
        labelPrice.textContent = 'Цена за 1 шт.'
        divPrice.append(labelPrice)
        formConfirmBuy.append(divPrice)

        let confirmBtn = document.createElement('button')
        confirmBtn.classList.add('btn', 'submit')
        confirmBtn.type = 'submit'
        confirmBtn.id = 'buyedConfirm'
        confirmBtn.textContent = 'Подтвердить'
        formConfirmBuy.addEventListener('submit', (e)=> {
            e.preventDefault()
            buyBtn.textContent = 'Приобретено!'
            buyBtn.classList.add('buyed')
            setTimeout(()=> {
                buyBtn.textContent = 'Купил'
                buyBtn.classList.remove('buyed')
            }, 2000)
            let obj = {
                id: order.id,
                order_id: '',
                seller: order.seller,
                item_id: order.item_id,
                item_img: order.icon,
                item_name: order.name.ru,
                item_url: order.url_name,
                price: order.price+order.benefit,
                quantity: Number(inputQuantity.value),
                market_price_date: order.date
            }
            if (typeof order.rank !== 'undefined') {
                obj.rank = selectRank.value
                obj.max_rank = order.max_rank
            }
            if (typeof order.subtype !== 'undefined') {
                obj.subtype = selectSubtype.value
                obj.subtypes = order.subtypes
            }

            let added = false
            buys.forEach((el, i)=> {
                if (added) return
                if (el.item_url == obj.item_url) {
                    if (typeof el.rank !== 'undefined') {
                        if (el.rank == obj.rank) {
                            buys[i].quantity = buys[i].quantity+1
                            added = true
                        }
                    } else if (typeof el.subtype !== 'undefined') {
                        if (el.subtype == obj.subtype) {
                            buys[i].quantity = buys[i].quantity+1
                            added = true
                        }
                    } else {
                        buys[i].quantity = buys[i].quantity+1
                        added = true
                    }
                }

                if (added) {
                    if (el.order_id != '') editItemToMarket({ id: el.id, order_id: el.order_id, price: el.price, quantity: buys[i].quantity, rank: el.rank, subtype: el.subtype })
                    document.querySelector('#platinumBuys-'+el.id+' .marketQuantityInput').value = buys[i].quantity
                } 
            })

            if (!added) {
                addInTableBuys(obj)
                buys.push(obj)
            }

            setValue('buys', buys)
            let id = genRndStr(24)
            while (actions.some((el)=> el.id == id)) {
                id = genRndStr(24)
            }
            let date = new Date()
            let time = date.toLocaleString('ru-US')
            obj = {
                id: id,
                name: order.name.ru+' x'+inputQuantity.value,
                platinum: inputPrice.value*-1*inputQuantity.value,
                date: time
            }
            actions.push(obj)
            setValue('actions', actions)
            addInActionsList(obj)
            toggleModal('buyModal')
        })
        formConfirmBuy.append(confirmBtn)
        document.querySelector('#buyModal .body').append(formConfirmBuy)
        toggleModal('buyModal')
    })

    if (order.module == 'platinum') {
        let mainDiv = document.createElement('div')
        mainDiv.id = 'platinum-'+order.id
        mainDiv.append(divItem)
        mainDiv.append(divBen)
        mainDiv.append(divEff)
        mainDiv.append(divSeller)
        mainDiv.append(divDate)
        let divBtns = document.createElement('div')
        divBtns.append(copyBtn)
        divBtns.append(buyBtn)
        mainDiv.append(divBtns)
        document.querySelector('#tablePlatinum').removeAttribute('style')
        document.querySelector('#nullTablePlatinum').style.display = 'none'
        document.querySelector('#tablePlatinum .body').prepend(mainDiv)
    }
}

function addInTableBuys(order) {
    //Предмет
    let divItem = document.createElement('div')
    let imgBox = document.createElement('div')
    imgBox.classList.add('img')
    let imgItem = document.createElement('img')
    imgItem.src = 'https://warframe.market/static/assets/'+order.item_img
    imgBox.append(imgItem)
    divItem.append(imgBox)
    let divInfo = document.createElement('div')
    divInfo.classList.add('info')
    let aItem = document.createElement('a')
    aItem.href = 'https://warframe.market/ru/items/'+order.item_url
    aItem.target = '_blank'
    aItem.textContent = order.item_name
    divInfo.append(aItem)
    divItem.append(divInfo)
    
    //Цена маркета
    let divMarketPrice = document.createElement('div')
    divMarketPrice.classList.add('marketPrice')
    divMarketPrice.append(order.price+' пл.')
    divMarketPrice.append(document.createElement('br'))
    divMarketPrice.append(document.createElement('br'))
    let dateArr = order.market_price_date.split(',')
    divMarketPrice.append(dateArr[0]+',')
    divMarketPrice.append(document.createElement('br'))
    divMarketPrice.append(dateArr[1])

    //Цена
    let divPrice = document.createElement('div')
    let inputPrice = document.createElement('input')
    inputPrice.classList.add('marketPriceInput')
    inputPrice.type = 'number'
    inputPrice.min = 1
    inputPrice.max = 9999
    inputPrice.placeholder = '0 - 9999'
    inputPrice.value = order.price
    inputPrice.addEventListener('change', ()=> {
        if (inputPrice.value == '') {
            buys.forEach((el, i)=> {
                if (el.id == order.id) inputPrice.value = buys[i].price
            })
            return
        }
        let quantity,
            rank,
            order_id,
            subtype
        buys.forEach((el, i)=> {
            if (el.id == order.id) {
                quantity = el.quantity
                rank = el.rank
                order_id = el.order_id
                subtype = el.subtype
            }
        })
        buys.forEach((el, i)=> {
            if (el.id == order.id) buys[i].price = inputPrice.value
        })
        setValue('buys', buys)
        if (order.order_id != '') {
            editItemToMarket({ id: order.id, order_id: order.order_id, price: inputPrice.value, quantity: quantity, rank: rank, subtype: subtype })
        }
    })
    divPrice.append(inputPrice)

    //Кол-во
    let divQuantity = document.createElement('div')
    let inputQuantity = document.createElement('input')
    inputQuantity.classList.add('marketQuantityInput')
    inputQuantity.type = 'number'
    inputQuantity.min = 1
    inputQuantity.max = 999
    inputQuantity.placeholder = '0 - 999'
    inputQuantity.value = order.quantity
    inputQuantity.addEventListener('change', ()=> {
        if (inputQuantity.value == '') {
            buys.forEach((el, i)=> {
                if (el.id == order.id) inputQuantity.value = buys[i].quantity
            })
            return
        }
        let price,
            rank,
            order_id,
            subtype
        buys.forEach((el, i)=> {
            if (el.id == order.id) {
                price = el.price
                rank = el.rank
                order_id = el.order_id
                subtype = el.subtype
            }
        })
        buys.forEach((el, i)=> {
            if (el.id == order.id) buys[i].quantity = Number(inputQuantity.value)
        })
        setValue('buys', buys)
        if (order.order_id != '') {
            editItemToMarket({ id: order.id, order_id: order.order_id, price: price, quantity: Number(inputQuantity.value), rank: rank, subtype: subtype })
        }
    })
    divQuantity.append(inputQuantity)

    //Ранг
    let divRank = document.createElement('div')
    let selectRank
    let selectSubtype
    if (typeof order.rank !== 'undefined') {
        selectRank = document.createElement('select')
        selectRank.classList.add('marketRankSelect')
        for (i = 0; i <= order.max_rank; i++) {
            let opt = document.createElement('option')
            opt.value = i
            opt.textContent = 'Ранг: '+i
            if (i == order.rank) opt.selected = 'selected'
            selectRank.append(opt)
        }
        selectRank.addEventListener('change', ()=> {
            let quantity,
                price,
                order_id
            buys.forEach((el, i)=> {
                if (el.id == order.id) {
                    quantity = el.quantity
                    price = el.price
                    order_id = el.order_id
                }
            })
            buys.forEach((el, i)=> {
                if (el.id == order.id) buys[i].rank = selectRank.value
            })
            setValue('buys', buys)
            if (order.order_id != '') {
                editItemToMarket({ id: order.id, order_id: order.order_id, price: price, quantity: quantity, rank: selectRank.value, subtype: null })
            }
        })
        divRank.append(selectRank)
    } else if (typeof order.subtype !== 'undefined') {
        selectSubtype = document.createElement('select')
        selectSubtype.classList.add('marketSubtypeSelect')
        order.subtypes.forEach((el)=> {
            let opt = document.createElement('option')
            opt.value = el
            opt.textContent = el
            if (el == order.subtype) opt.selected = 'selected'
            selectSubtype.append(opt)
        })
        selectSubtype.addEventListener('change', ()=> {
            let quantity,
                price,
                order_id,
                rank
            buys.forEach((el, i)=> {
                if (el.id == order.id) {
                    quantity = el.quantity
                    price = el.price
                    order_id = el.order_id
                }
            })
            if (order.order_id != '') {
                editItemToMarket({ id: order.id, order_id: order.order_id, price: price, quantity: quantity, rank: null, subtype: selectSubtype.value })
            } else {
                buys.forEach((el, i)=> {
                    if (el.id == order.id) buys[i].subtype = selectSubtype.value
                })
                setValue('buys', buys)
            }
        })
        divRank.append(selectSubtype)
    } else {
        divRank.textContent = ' '
    }

    //Продано
    let sellBtn = document.createElement('button')
    sellBtn.classList.add('btn', 'sell')
    if (order.order_id == '') sellBtn.style.display = 'none'
    sellBtn.textContent = 'Продано'
    sellBtn.addEventListener('click', async ()=> {
        if (sellBtn.classList.contains('wait')) return
        sellBtn.textContent = 'Подождите...'
        sellBtn.classList.add('wait')
        let check = await sellItemOnMarket(order.id)
        if (check.success) {
            sellBtn.classList.add('onSale')
            sellBtn.textContent = 'Продано'
        } else {
            sellBtn.classList.add('error')
            sellBtn.textContent = 'Ошибка!'
            setTimeout(()=> {
                sellBtn.classList.remove('error')
                sellBtn.textContent = 'Продано'
            }, 2000)
        }
        sellBtn.classList.remove('wait')
    })

    //Выставить / Снять
    let putBtn = document.createElement('button')
    putBtn.classList.add('btn', 'put')
    if (order.order_id != '') putBtn.classList.add('onSale')
    putBtn.textContent = (order.order_id != '') ? 'Снять с маркета' : 'Выставить'
    putBtn.addEventListener('click', async ()=> {
        if (putBtn.classList.contains('wait')) return
        putBtn.textContent = 'Подождите...'
        putBtn.classList.add('wait')
        if (!putBtn.classList.contains('onSale')) {
            let rank = (typeof order.rank !== 'undefined') ? selectRank.value : undefined
            let subtype = (typeof order.subtype !== 'undefined') ? selectSubtype.value : undefined
            let check = await addItemToMarket({ id: order.id, item_id: order.item_id, price: inputPrice.value, quantity: Number(inputQuantity.value), rank: rank, subtype: subtype })
            if (check.success) {
                sellBtn.removeAttribute('style')
                putBtn.classList.add('onSale')
                putBtn.textContent = 'Снять с маркета'
            } else {
                putBtn.classList.add('error')
                putBtn.textContent = 'Ошибка!'
                setTimeout(()=> {
                    putBtn.classList.remove('error')
                    putBtn.textContent = 'Выставить'
                }, 2000)
            }
        } else {
            let check = await removeItemFromMarket(order.id)
            if (check.success || check.message == 'order_not_exist') {
                putBtn.classList.remove('error', 'onSale')
                sellBtn.style.display = 'none'
                putBtn.textContent = 'Выставить'
                if (check.message == 'order_not_exist') {
                    putBtn.classList.add('error')
                    putBtn.textContent = 'Товар уже снят!'
                    setTimeout(()=> {
                        putBtn.classList.remove('error', 'onSale')
                        putBtn.textContent = 'Выставить'
                    }, 2000)
                }
            } else {
                putBtn.classList.add('error')
                putBtn.textContent = 'Ошибка!'
                setTimeout(()=> {
                    putBtn.classList.remove('error')
                    putBtn.textContent = 'Снять с маркета'
                }, 2000)
            }
        }
        putBtn.classList.remove('wait')
    })

    //Удалить 
    let removeBtn = document.createElement('button')
    removeBtn.classList.add('btn', 'remove')
    removeBtn.textContent = 'Удалить'
    removeBtn.addEventListener('click', ()=> {
        removeBtn.parentElement.parentElement.remove()
        if (document.querySelectorAll('#tablePlatinumBuys .body > div').length == 0) {
            document.querySelector('#tablePlatinumBuys').style.display = 'none'
            document.querySelector('#nullTablePlatinumBuys').removeAttribute('style')
        }
        setValue('orderHistory', orderHistory)

        buys.forEach((el, i)=> {
            if (el.id == order.id) buys.splice(i, 1)
        })
        setValue('buys', buys)
    })

    let mainDiv = document.createElement('div')
    mainDiv.id = 'platinumBuys-'+order.id
    mainDiv.append(divItem)
    mainDiv.append(divMarketPrice)
    mainDiv.append(divPrice)
    mainDiv.append(divQuantity)
    mainDiv.append(divRank)
    let divBtns = document.createElement('div')
    let divPutSell = document.createElement('div')
    divPutSell.append(putBtn)
    divPutSell.append(sellBtn)
    divBtns.append(divPutSell)
    divBtns.append(removeBtn)
    mainDiv.append(divBtns)
    document.querySelector('#tablePlatinumBuys').removeAttribute('style')
    document.querySelector('#nullTablePlatinumBuys').style.display = 'none'
    document.querySelector('#tablePlatinumBuys .body').prepend(mainDiv)
}

async function sellItemOnMarket(id) {
    let doc = await parseURL('https://warframe.market')
    let csrf = doc.querySelector('[name="csrf-token"]').getAttribute('content')
    let orderID
    buys.forEach((el)=> {
        if (el.id == id) orderID = el.order_id
    })
    try {
        response = await fetch("https://api.warframe.market/v1/profile/orders/close/"+orderID, {
            "headers": {
                "content-type": "application/json",
                "x-csrftoken": csrf
            },
            "body": null,
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
            if (el.id == id) {
                if (buys[i].quantity == 1) {
                    buys.splice(i, 1)
                    document.querySelector('#platinumBuys-'+el.id).remove()
                    if (document.querySelectorAll('#tablePlatinumBuys .body > div').length == 0) {
                        document.querySelector('#tablePlatinumBuys').style.display = 'none'
                        document.querySelector('#nullTablePlatinumBuys').removeAttribute('style')
                    }
                    setValue('orderHistory', orderHistory)
                } else {
                    buys[i].quantity = buys[i].quantity-1
                    document.querySelector('#platinumBuys-'+el.id+' .marketQuantityInput').value = buys[i].quantity
                }
                let id = genRndStr(24)
                while (actions.some((el)=> el.id == id)) {
                    id = genRndStr(24)
                }
                let date = new Date()
                let time = date.toLocaleString('ru-US')
                let obj = {
                    id: id,
                    name: el.item_name+' x1',
                    platinum: el.price,
                    date: time
                }
                actions.push(obj)
                setValue('actions', actions)
                addInActionsList(obj)
            }
        })
        setValue('buys', buys)
        return { success: true, message: 'response.ok' }
    } else if (!response.ok) {
        return { success: false, message: 'response.ok != true' }
    }
    return { success: false, message: 'unknown_error' }
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

async function addItemToMarket(order) {
    let doc = await parseURL('https://warframe.market')
    let csrf = doc.querySelector('[name="csrf-token"]').getAttribute('content')
    try {
        let body = '{\"order_type\":\"sell\",\"item_id\":\"'+order.item_id+'\",\"platinum\":'+order.price+',\"quantity\":'+order.quantity+',\"visible\":true'
        body += (order.rank != null) ? ',\"rank\":'+order.rank : ''
        body += (order.subtype != null) ? ',\"subtype\":\"'+order.subtype+'\"' : ''
        body += '}'
        response = await fetch("https://api.warframe.market/v1/profile/orders", {
            "headers": {
                "content-type": "application/json",
                "x-csrftoken": csrf
            },
            "body": body,
            "method": "POST",
            "mode": "cors",
            "credentials": "include"
        })
    } catch (e) {
        return { success: false, message: 'response_error' }
    }
    let data = await response.json()
    if (typeof data.payload !== 'undefined') {
        buys.forEach((el, i)=> {
            if (el.id == order.id) buys[i].order_id = data.payload.order.id
        })
        setValue('buys', buys)
        return { success: true, message: 'response.ok' }
    } else if (!response.ok) {
        return { success: false, message: 'response.ok != true' }
    }
    return { success: false, message: 'unknown_error' }
}

async function removeItemFromMarket(id) {
    let doc = await parseURL('https://warframe.market')
    let csrf = doc.querySelector('[name="csrf-token"]').getAttribute('content')
    let orderID
    buys.forEach((el)=> {
        if (el.id == id) orderID = el.order_id
    })
    try {
        response = await fetch("https://api.warframe.market/v1/profile/orders/"+orderID, {
            "headers": {
                "content-type": "application/json",
                "x-csrftoken": csrf
            },
            "method": "DELETE",
            "mode": "cors",
            "credentials": "include"
        })
    } catch (e) {
        return { success: false, message: 'response_error' }
    }
    buys.forEach((el, i)=> {
        if (el.order_id == orderID) buys[i].order_id = ''
    })
    setValue('buys', buys)
    let data = await response.json()
    if (typeof data.payload !== 'undefined') {
        return { success: true, message: 'response.ok' }
    } else if (data.error.order_id[0] == 'app.delete_order.order_not_exist') {
        return { success: false, message: 'order_not_exist' }
    } else if (!response.ok) {
        return { success: false, message: 'response.ok != true' }
    }
    return { success: false, message: 'unknown_error' }
}

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

//Отрисовка новостей
async function loadNews() {
    let news = await getValue('news')
    if (typeof news == 'undefined') return
    else if (!Object.keys(news).length) return
    timersID.forEach((timer)=> clearInterval(timer))
    timersID = []

    //Циклы
    loadCycles()
    function loadCycles() {
        let blockNode = document.querySelector('#cyclesNewsBlock')
        blockNode.textContent = ''


        let mainDiv,
            spanPlace,
            cycleTemp,
            spanTimer

        //Цикл цетуса
        mainDiv = document.createElement('div')
        mainDiv.classList.add('news-element')
        spanPlace = document.createElement('span')
        spanPlace.classList.add('bold')
        cycleTemp = (!news.cetusCycle.isDay) ? 'Ночь' : 'День'
        spanPlace.textContent = 'Равнины Эйдолона - [Сейчас: '+cycleTemp+']'
        mainDiv.append(spanPlace)
        spanTimer = document.createElement('span')
        spanTimer.id = 'timer-'+news.cetusCycle.id
        mainDiv.append(spanTimer)
        timerGo('timer-'+news.cetusCycle.id, news.cetusCycle.expiry)

        blockNode.append(mainDiv)

        //Цикл земли
        mainDiv = document.createElement('div')
        mainDiv.classList.add('news-element')
        spanPlace = document.createElement('span')
        spanPlace.classList.add('bold')
        cycleTemp = (!news.earthCycle.isDay) ? 'Ночь' : 'День'
        spanPlace.textContent = 'Земля - [Сейчас: '+cycleTemp+']'
        mainDiv.append(spanPlace)
        spanTimer = document.createElement('span')
        spanTimer.id = 'timer-'+news.earthCycle.id
        mainDiv.append(spanTimer)
        timerGo('timer-'+news.earthCycle.id, news.earthCycle.expiry)

        blockNode.append(mainDiv)

        //Цикл долины сфер
        mainDiv = document.createElement('div')
        mainDiv.classList.add('news-element')
        spanPlace = document.createElement('span')
        spanPlace.classList.add('bold')
        cycleTemp = (!news.vallisCycle.isWarm) ? 'Холодно' : 'Тепло'
        spanPlace.textContent = 'Долина Сфер - [Сейчас: '+cycleTemp+']'
        mainDiv.append(spanPlace)
        spanTimer = document.createElement('span')
        spanTimer.id = 'timer-'+news.vallisCycle.id
        mainDiv.append(spanTimer)
        timerGo('timer-'+news.vallisCycle.id, news.vallisCycle.expiry)

        blockNode.append(mainDiv)

        //Цикл дрейф
        mainDiv = document.createElement('div')
        mainDiv.classList.add('news-element')
        spanPlace = document.createElement('span')
        spanPlace.classList.add('bold')
        cycleTemp = (news.cambionCycle.active == 'vome') ? 'Воум' : 'Фэз'
        spanPlace.textContent = 'Камбионский Дрейф - [Сейчас: '+cycleTemp+']'
        mainDiv.append(spanPlace)
        spanTimer = document.createElement('span')
        spanTimer.id = 'timer-'+news.cambionCycle.id
        mainDiv.append(spanTimer)
        timerGo('timer-'+news.cambionCycle.id, news.cambionCycle.expiry)

        blockNode.append(mainDiv)

        //Цикл заримана
        mainDiv = document.createElement('div')
        mainDiv.classList.add('news-element')
        spanPlace = document.createElement('span')
        spanPlace.classList.add('bold')
        cycleTemp = (news.zarimanCycle.isCorpus) ? 'Корпус' : 'Гринир'
        spanPlace.textContent = 'Зариман - [Сейчас: '+cycleTemp+']'
        mainDiv.append(spanPlace)
        spanTimer = document.createElement('span')
        spanTimer.id = 'timer-'+news.zarimanCycle.id
        mainDiv.append(spanTimer)
        timerGo('timer-'+news.zarimanCycle.id, news.zarimanCycle.expiry)

        blockNode.append(mainDiv)

        if (!document.querySelector('#cyclesNewsBlock *')) {
            let voidNode = document.createElement('div')
            voidNode.classList.add('news-element', 'bold')
            voidNode.textContent = '[Все циклы приостановлены]'
            voidNode.setAttribute('align', 'center')
            voidNode.style.display = 'block'
            blockNode.append(voidNode)
        }
    }

    //Тревоги
    loadAlerts()
    function loadAlerts() {
        let blockNode = document.querySelector('#alertsNewsBlock')
        blockNode.textContent = ''

        news.alerts.forEach((alert)=> {
            let mainDiv = document.createElement('div')
            mainDiv.classList.add('news-element')
            let spanName = document.createElement('span')
            spanName.classList.add('bold')
            spanName.textContent = alert.mission.description+' - '+alert.mission.node
            mainDiv.append(spanName)
            let spanTimer = document.createElement('span')
            spanTimer.id = 'timer-'+alert.id
            mainDiv.append(spanTimer)
            timerGo('timer-'+alert.id, alert.expiry)

            blockNode.append(mainDiv)
        })

        if (!document.querySelector('#alertsNewsBlock *')) {
            let voidNode = document.createElement('div')
            voidNode.classList.add('news-element', 'bold')
            voidNode.textContent = '[Сейчас нет активных сигналов тревоги]'
            voidNode.setAttribute('align', 'center')
            voidNode.style.display = 'block'
            blockNode.append(voidNode)
        }
    }

    //Ивенты
    loadEvents()
    function loadEvents() {
        let blockNode = document.querySelector('#eventsNewsBlock')
        blockNode.textContent = ''

        news.events.forEach((event)=> {
            let mainDiv = document.createElement('div')
            mainDiv.classList.add('news-element')
            let spanName = document.createElement('span')
            spanName.classList.add('bold')
            let desc = ' - ('+event.faction+')'
            if (!event.faction) desc = ' - '+event.node
            if (!event.node) desc = ' - '+event.victimNode
            if (!event.victimNode) desc = ''
            spanName.textContent = event.description+desc
            mainDiv.append(spanName)
            let spanTimer = document.createElement('span')
            spanTimer.id = 'timer-'+event.id
            mainDiv.append(spanTimer)
            timerGo('timer-'+event.id, event.expiry)

            blockNode.append(mainDiv)
        })

        if (!document.querySelector('#eventsNewsBlock *')) {
            let voidNode = document.createElement('div')
            voidNode.classList.add('news-element', 'bold')
            voidNode.textContent = '[Сейчас нет активных событий]'
            voidNode.setAttribute('align', 'center')
            voidNode.style.display = 'block'
            blockNode.append(voidNode)
        }
    }

    //Вторжения
    loadInvasions()
    function loadInvasions() {
        let blockNode = document.querySelector('#invasionsNewsBlock')
        blockNode.textContent = ''
        news.invasions = news.invasions.sort((prev, next) => {
            let prevInvDate = new Date(prev.activation)
            let nextInvDate = new Date(next.activation)
            return prevInvDate.getTime() - nextInvDate.getTime()
        }).reverse()

        news.invasions.forEach((invasion)=> {
            if (invasion.completed) return
            if (invasion.completion > 100) invasion.completion = 100
            if (invasion.completion < 0) invasion.completion = 0

            let mainDiv = document.createElement('div')
            mainDiv.classList.add('news-element')
            let divInfo = document.createElement('div')
            let spanDesc = document.createElement('span')
            spanDesc.classList.add('bold')
            spanDesc.textContent = invasion.node+' - '+invasion.desc
            divInfo.append(spanDesc)
            let percents = document.createElement('span')
            percents.textContent = invasion.completion.toFixed(2)+'%'
            divInfo.append(percents)

            let rewsDiv = document.createElement('div')
            let rew1 = document.createElement('span')
            if (invasion.attackerReward.asString) {
                rew1.classList.add('news-label')
                rew1.textContent = invasion.attackerReward.asString
            }
            rewsDiv.append(rew1)
            let rew2 = document.createElement('span')
            if (invasion.defenderReward.asString) {
                rew2.classList.add('news-label')
                rew2.textContent = invasion.defenderReward.asString
            }
            rewsDiv.append(rew2)

            let attColor
            if (invasion.attacker.factionKey == 'Corpus') attColor = '#2e9dd4'
            else if (invasion.attacker.factionKey == 'Grineer') attColor = '#fd6d6d'
            else if (invasion.attacker.factionKey == 'Infested') attColor = '#6de483'
            let defColor
            if (invasion.defender.factionKey == 'Corpus') defColor = '#2e9dd4'
            else if (invasion.defender.factionKey == 'Grineer') defColor = '#fd6d6d'
            else if (invasion.defender.factionKey == 'Infested') defColor = '#6de483'
            let progBar = document.createElement('div')
            progBar.classList.add('progBar')
            progBar.style.background = defColor
            let progBar2 = document.createElement('div')
            progBar2.classList.add('progBar')
            progBar2.style.width = 'calc('+invasion.completion.toFixed(2)+'% + 7px)'
            progBar2.style.background = attColor
            progBar.append(progBar2)
            
            mainDiv.append(divInfo)
            mainDiv.append(progBar)
            mainDiv.append(rewsDiv)

            blockNode.append(mainDiv)
        })

        if (!document.querySelector('#invasionsNewsBlock *')) {
            let voidNode = document.createElement('div')
            voidNode.classList.add('news-element', 'bold')
            voidNode.textContent = '[Сейчас нет вторжений]'
            voidNode.setAttribute('align', 'center')
            voidNode.style.display = 'block'
            blockNode.append(voidNode)
        }
    }

    //Ночная волна
    loadNightwave()
    function loadNightwave() {
        let blockNode = document.querySelector('#nightwaveNewsBlock')
        blockNode.textContent = ''

        if (typeof news.nightwave !== 'undefined') {
            if (document.querySelector('#timer-nightwave')) document.querySelector('#timer-nightwave').remove()
            let nightwaveTimer = document.createElement('span')
            nightwaveTimer.id = 'timer-nightwave'
            let nightwaveTime = new Date(news.nightwave.expiry)
            nightwaveTime = [
                addLeadZero(nightwaveTime.getDate()),
                addLeadZero(nightwaveTime.getMonth() + 1),
                nightwaveTime.getFullYear()
            ].join('.')
            nightwaveTimer.textContent = ' [Окончание: '+nightwaveTime+']'
            blockNode.previousElementSibling.append(nightwaveTimer)

            news.nightwave.activeChallenges = news.nightwave.activeChallenges.sort((prev, next) => prev.reputation - next.reputation).reverse()

            news.nightwave.activeChallenges.forEach((challenge)=> {
                let mainDiv = document.createElement('div')
                mainDiv.classList.add('news-element')
                let divHead = document.createElement('div')
                let divInfo = document.createElement('div')
                let spanRew = document.createElement('span')
                spanRew.classList.add('news-label', 'mr-1')
                spanRew.textContent = challenge.reputation+' реп.'
                divInfo.append(spanRew)
                let spanTitle = document.createElement('span')
                spanTitle.classList.add('bold')
                spanTitle.textContent = challenge.title
                divInfo.append(spanTitle)
                divHead.append(divInfo)
                let spanTimer = document.createElement('span')
                spanTimer.id = 'timer-'+challenge.id
                divHead.append(spanTimer)
                timerGo('timer-'+challenge.id, challenge.expiry)
                mainDiv.append(divHead)
                let divDesc = document.createElement('div')
                divDesc.textContent = challenge.desc
                mainDiv.append(divDesc)

                blockNode.append(mainDiv)
            })
        }

        if (!document.querySelector('#nightwaveNewsBlock *')) {
            let voidNode = document.createElement('div')
            voidNode.classList.add('news-element', 'bold')
            voidNode.textContent = '[Ночная волна сейчас не активна]'
            voidNode.setAttribute('align', 'center')
            voidNode.style.display = 'block'
            blockNode.append(voidNode)
        }
    }

    //Архонты
    loadArchon()
    function loadArchon() {
        let blockNode = document.querySelector('#archonNewsBlock')
        blockNode.textContent = ''

        let mainDiv = document.createElement('div')
        mainDiv.classList.add('news-element')
        let divInfo = document.createElement('div')
        let spanAttacker = document.createElement('span')
        spanAttacker.classList.add('bold')
        spanAttacker.textContent = 'Нападающий: '+news.archonHunt.boss
        divInfo.append(spanAttacker)
        let spanTimer = document.createElement('span')
        spanTimer.classList.add('text-right')
        spanTimer.id = 'timer-'+news.archonHunt.id
        divInfo.append(spanTimer)
        timerGo('timer-'+news.archonHunt.id, news.archonHunt.expiry)
        mainDiv.append(divInfo)
        let divMissions = document.createElement('div')
        divMissions.classList.add('news-sortie')
        news.archonHunt.missions.forEach((miss, i)=> {
            let divMiss = document.createElement('div')
            let divType = document.createElement('div')
            divType.textContent = i+1+'. '+miss.type
            divMiss.append(divType)
            let divNode = document.createElement('div')
            divNode.textContent = miss.node
            divMiss.append(divNode)
            divMissions.append(divMiss)
        })
        mainDiv.append(divMissions)

        blockNode.append(mainDiv)

        if (!document.querySelector('#archonNewsBlock *')) {
            let voidNode = document.createElement('div')
            voidNode.classList.add('news-element', 'bold')
            voidNode.textContent = '[Архонты сейчас недоступны]'
            voidNode.setAttribute('align', 'center')
            voidNode.style.display = 'block'
            blockNode.append(voidNode)
        }
    }

    //Вылазка
    loadSortie()
    function loadSortie() {
        let blockNode = document.querySelector('#sortieNewsBlock')
        blockNode.textContent = ''

        let mainDiv = document.createElement('div')
        mainDiv.classList.add('news-element')
        let divInfo = document.createElement('div')
        let spanAttacker = document.createElement('span')
        spanAttacker.classList.add('bold')
        spanAttacker.textContent = 'Нападающий: '+news.sortie.boss
        divInfo.append(spanAttacker)
        let spanTimer = document.createElement('span')
        spanTimer.classList.add('text-right')
        spanTimer.id = 'timer-'+news.sortie.id
        divInfo.append(spanTimer)
        timerGo('timer-'+news.sortie.id, news.sortie.expiry)
        mainDiv.append(divInfo)
        let divMissions = document.createElement('div')
        divMissions.classList.add('news-sortie')
        news.sortie.variants.forEach((variant, i)=> {
            let divMiss = document.createElement('div')
            let divType = document.createElement('div')
            divType.textContent = i+1+'. '+variant.missionType
            divMiss.append(divType)
            let divMod = document.createElement('div')
            divMod.textContent = variant.modifier
            divMiss.append(divMod)
            divMissions.append(divMiss)
        })
        mainDiv.append(divMissions)

        blockNode.append(mainDiv)

        if (!document.querySelector('#sortieNewsBlock *')) {
            let voidNode = document.createElement('div')
            voidNode.classList.add('news-element', 'bold')
            voidNode.textContent = '[Сейчас вылазка недоступна]'
            voidNode.setAttribute('align', 'center')
            voidNode.style.display = 'block'
            blockNode.append(voidNode)
        }
    }

    //Торговец бездны
    loadTrader()
    function loadTrader() {
        let blockNode = document.querySelector('#traderNewsBlock')
        blockNode.textContent = ''

        let mainDiv = document.createElement('div')
        mainDiv.classList.add('news-element')
        
        let block = document.createElement('div')
        let spanMove= document.createElement('span')
        spanMove.classList.add('bold')
        let moveTrade = (!news.voidTrader.active) ? 'В пути ❯❯❯    ' : 'Ожидает ❯❯❯    '
        spanMove.textContent = moveTrade+news.voidTrader.location
        block.append(spanMove)
        let spanTimer = document.createElement('span')
        spanTimer.id = 'timer-'+news.voidTrader.id
        let timeTrade = (!news.voidTrader.active) ? news.voidTrader.activation : news.voidTrader.expiry
        block.append(spanTimer)

        mainDiv.append(block)

        if (news.voidTrader.active) {
            news.voidTrader.inventory.sort((prev, next) => next.ducats - prev.ducats).forEach((el)=> {
                let tradeDiv = document.createElement('div')
                let tradeSpan = document.createElement('span')
                tradeSpan.textContent = el.item
                tradeDiv.append(tradeSpan)
                let priceDiv = document.createElement('div')
                let credSpan = document.createElement('span')
                credSpan.classList.add('news-label', 'mr-1')
                credSpan.textContent = el.credits+' кред.'
                priceDiv.append(credSpan)
                let ducSpan = document.createElement('span')
                ducSpan.classList.add('news-label')
                ducSpan.textContent = el.ducats+' дук.'
                priceDiv.append(ducSpan)
                tradeDiv.append(priceDiv)

                mainDiv.append(tradeDiv)
            })
        }
        timerGo('timer-'+news.voidTrader.id, timeTrade)

        blockNode.append(mainDiv)

        if (!document.querySelector('#traderNewsBlock *')) {
            let voidNode = document.createElement('div')
            voidNode.classList.add('news-element', 'bold')
            voidNode.textContent = '[От торговца бездны нет вестей]'
            voidNode.setAttribute('align', 'center')
            voidNode.style.display = 'block'
            blockNode.append(voidNode)
        }
    }

    //Предложения Дарво
    loadDailyDeals()
    function loadDailyDeals() {
        let blockNode = document.querySelector('#dailyDealsNewsBlock')
        blockNode.textContent = ''

        news.dailyDeals.forEach((deal)=> {
            let mainDiv = document.createElement('div')
            mainDiv.classList.add('news-element')
            let divHead = document.createElement('div')
            let spanItem = document.createElement('span')
            spanItem.classList.add('bold')
            spanItem.textContent = deal.item
            divHead.append(spanItem)
            let spanTimer = document.createElement('span')
            spanTimer.id = 'timer-'+deal.id
            divHead.append(spanTimer)
            timerGo('timer-'+deal.id, deal.expiry)
            mainDiv.append(divHead)
            let divInfo = document.createElement('div')
            divInfo.classList.add('news-info')
            let spanDisc = document.createElement('span')
            spanDisc.classList.add('news-label')
            spanDisc.textContent = 'Скидка: -'+deal.discount+'%'
            divInfo.append(spanDisc)
            let spanPrice = document.createElement('span')
            spanPrice.classList.add('news-label')
            spanPrice.textContent = 'Цена: '+deal.salePrice+' пл.'
            divInfo.append(spanPrice)
            let spanCount = document.createElement('span')
            spanCount.classList.add('news-label')
            spanCount.textContent = 'Продано: '+deal.sold+'/'+deal.total
            divInfo.append(spanCount)
            mainDiv.append(divInfo)

            blockNode.append(mainDiv)
        })

        if (!document.querySelector('#dailyDealsNewsBlock *')) {
            let voidNode = document.createElement('div')
            voidNode.classList.add('news-element', 'bold')
            voidNode.textContent = '[У Дарво сейчас нет выгодных предложений]'
            voidNode.setAttribute('align', 'center')
            voidNode.style.display = 'block'
            blockNode.append(voidNode)
        }
    }

    //Предложения Дарво
    loadTeshinDeals()
    function loadTeshinDeals() {
        let blockNode = document.querySelector('#teshinDealsNewsBlock')
        blockNode.textContent = ''

        let nextRewIndex
        news.steelPath.rotation.forEach((el, i)=> {
            if (el.name == news.steelPath.currentReward.name) nextRewIndex = i
        })
        let prevRewIndex = (nextRewIndex == 0) ? news.steelPath.rotation.length-1 : nextRewIndex-1
        nextRewIndex = (nextRewIndex == news.steelPath.rotation.length-1) ? 0 : nextRewIndex+1

        let mainDiv = document.createElement('div')
        mainDiv.classList.add('news-element')
        let divDesc1 = document.createElement('div')
        divDesc1.classList.add('additions')
        divDesc1.textContent = '↑ '+news.steelPath.rotation[prevRewIndex].name+' - [Цена: '+news.steelPath.rotation[prevRewIndex].cost+' эс.]'
        mainDiv.append(divDesc1)
        let divHead = document.createElement('div')
        let divInfo = document.createElement('div')
        let spanTitle = document.createElement('span')
        spanTitle.classList.add('bold')
        spanTitle.textContent = news.steelPath.currentReward.name+' - [Цена: '+news.steelPath.currentReward.cost+' эс.]'
        divInfo.append(spanTitle)
        divHead.append(divInfo)
        let spanTimer = document.createElement('span')
        spanTimer.id = 'timer-TeshinDeals'
        divHead.append(spanTimer)
        timerGo('timer-TeshinDeals', 'monday')
        mainDiv.append(divHead)
        let divDesc2 = document.createElement('div')
        divDesc2.classList.add('additions')
        divDesc2.textContent = '↓ '+news.steelPath.rotation[nextRewIndex].name+' - [Цена: '+news.steelPath.rotation[nextRewIndex].cost+' эс.]'
        mainDiv.append(divDesc2)

        blockNode.append(mainDiv)

        if (!document.querySelector('#teshinDealsNewsBlock *')) {
            let voidNode = document.createElement('div')
            voidNode.classList.add('news-element', 'bold')
            voidNode.textContent = '[У Тешина сейчас нет специального предложения]'
            voidNode.setAttribute('align', 'center')
            voidNode.style.display = 'block'
            blockNode.append(voidNode)
        }
    }

    //Разрывы
    loadFissures()
    function loadFissures() {
        news.fissures = news.fissures.sort((prev, next)=> {
            if (prev.isStorm != next.isStorm) {
                return prev.isStorm ? -1 : 1
            } else if (prev.isHard != next.isHard) {
                return prev.isHard ? -1 : 1
            }
            return prev.tierNum - next.tierNum
        }).reverse()

        let blockNode = document.querySelector('#fissuresNewsBlock')
        blockNode.textContent = ''

        news.fissures.forEach((fissure, i)=> {
            let mainDiv = document.createElement('div')
            mainDiv.classList.add('news-element')
            let divInfo = document.createElement('div')
            let prefix = (fissure.isHard) ? '✦ ' : ''
            prefix += (fissure.isStorm) ? '☼ ' : ''
            divInfo.append(prefix)
            let spanTier = document.createElement('span')
            spanTier.classList.add('news-label', 'mr-1')
            spanTier.textContent = fissure.tier
            divInfo.append(spanTier)
            let spanMiss = document.createElement('span')
            spanMiss.classList.add('bold')
            spanMiss.textContent = fissure.node+' - '+fissure.missionType
            divInfo.append(spanMiss)
            mainDiv.append(divInfo)
            let spanTimer = document.createElement('span')
            spanTimer.id = 'timer-'+fissure.id
            mainDiv.append(spanTimer)
            timerGo('timer-'+fissure.id, fissure.expiry)

            blockNode.append(mainDiv)
            if (typeof news.fissures[i+1] === 'undefined') return
            if (fissure.isHard != news.fissures[i+1].isHard || fissure.isStorm != news.fissures[i+1].isStorm) {
                blockNode.append(document.createElement('br'))
            }
        })

        if (!document.querySelector('#fissuresNewsBlock *')) {
            let voidNode = document.createElement('div')
            voidNode.classList.add('news-element', 'bold')
            voidNode.textContent = '[Активных разрывов не обнаружено]'
            voidNode.setAttribute('align', 'center')
            voidNode.style.display = 'block'
            blockNode.append(voidNode)
        }
    }

    //Новости
    loadWFNews()
    function loadWFNews() {
        news.news = news.news.sort((prev, next) => Date.parse(prev.date) - Date.parse(next.date)).reverse()

        let blockNode = document.querySelector('#newsNewsBlock')
        blockNode.textContent = ''

        news.news.forEach((newsItem)=> {
            let mainDiv = document.createElement('div')
            mainDiv.classList.add('news-element')
            let spanDate = document.createElement('span')
            spanDate.classList.add('bold')
            let date = (Date.parse(new Date()) - Date.parse(newsItem.date))
            let dateDays = date/86400000
            let dateHours = date/3600000
            let dateMins = date/60000
            let dateShow
            if (dateDays >= 1) dateShow = Math.round(dateDays)+'д'
            else if (dateHours >= 1) dateShow = Math.round(dateHours)+'ч'
            else dateShow = Math.round(dateMins)+'м'
            spanDate.textContent = '[ '+dateShow+' ]'
            mainDiv.append(spanDate)
            let aLink = document.createElement('a')
            aLink.setAttribute('href', newsItem.link)
            aLink.setAttribute('target', '_blank')
            aLink.textContent = newsItem.message
            mainDiv.append(aLink)

            blockNode.append(mainDiv)
        })

        if (!document.querySelector('#newsNewsBlock *')) {
            let voidNode = document.createElement('div')
            voidNode.classList.add('news-element', 'bold')
            voidNode.textContent = '[В последнее время не было новостей]'
            voidNode.setAttribute('align', 'center')
            voidNode.style.display = 'block'
            blockNode.append(voidNode)
        }
    }
}