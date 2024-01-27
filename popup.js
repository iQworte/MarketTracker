document.querySelector('#closePopup').addEventListener('click', ()=> window.close())
document.querySelector('#openSettings').href = 'chrome-extension://'+chrome.runtime.id+'/options.html'
document.addEventListener('DOMContentLoaded', ()=> document.querySelector('#inputWikiSearch').focus())
document.querySelector('form').addEventListener('submit', async (e)=> {
	e.preventDefault()
	if (document.querySelector('#inputWikiSearch').value == '') return
	chrome.tabs.create({url: 'https://warframe.fandom.com/ru/wiki/Служебная:Поиск?query='+document.querySelector('#inputWikiSearch').value})
})