const streamerName = document.getElementById("streamerName");
const streamerPlatform = document.getElementById("streamerPlatform");
const streamerChannel = document.getElementById("streamerChannel");
const streamerStatus = document.getElementById("streamerStatus");
const addStreamer = document.getElementById("addStreamer");
const streamerList = document.getElementById("streamerList");
const streamerSelect = document.getElementById("streamerSelect");
const alertMessage = document.getElementById("alertMessage");
const alertType = document.getElementById("alertType");
const updateAlert = document.getElementById("updateAlert");
const clearAlert = document.getElementById("clearAlert");
const currentAlert = document.getElementById("currentAlert");
const articleTitle = document.getElementById("articleTitle");
const articleDate = document.getElementById("articleDate");
const articleContentTop = document.getElementById("articleContentTop");
const articleImage = document.getElementById("articleImage");
const articleYoutube = document.getElementById("articleYoutube");
const articleContentBottom = document.getElementById("articleContentBottom");
const addArticle = document.getElementById("addArticle");
const articleList = document.getElementById("articleList");

let streamers = getStreamers();

let editingArticleIndex = null;

const onlineButton = document.getElementById("onlineButton");
const awayButton = document.getElementById("awayButton");

const offlineButton = document.getElementById("offlineButton");



function loadStreamerDropdown() {

    streamerSelect.innerHTML = "";

    streamers.forEach((streamer, index) => {

        const option = document.createElement("option");

        option.value = index;
        option.textContent = streamer.name;

        streamerSelect.appendChild(option);

    });

}


function displayStreamers() {

    

    streamerList.replaceChildren();

    streamers.forEach((streamer, index) => {

        const div = document.createElement("div");

        div.innerHTML = `
            <strong>${streamer.name}</strong>
            <p>Status: ${streamer.status}</p>
        `;

        streamerList.appendChild(div);

    });

}

function displayCurrentAlert() {

    const alert = getAlert();

    if (!alert) {
        currentAlert.textContent = "No active alert";
        currentAlert.style.backgroundColor = "#adadad";
        currentAlert.style.color = "black";
        return;
    }

    currentAlert.textContent = alert.message;

    if (alert.type === "news") {
        currentAlert.style.backgroundColor = "#2ecc71";
    }

    if (alert.type === "maintenance") {
        currentAlert.style.backgroundColor = "#e74c3c";
    }

    currentAlert.style.color = "white";

}

function displayArticles() {

    const savedArticles = getArticles();

    articleList.innerHTML = "";

    savedArticles.forEach((article, index) => {

        const div = document.createElement("div");

       div.innerHTML = `
    <strong>${article.title}</strong>
    <p>${article.date}</p>
    <button onclick="editArticle(${index})">Edit</button>
<button onclick="deleteArticle(${index})">Delete</button>
`;

        articleList.appendChild(div);

    });

}

function deleteArticle(index) {

    const confirmDelete = confirm("Are you sure you want to delete this article?");

    if (!confirmDelete) {
        return;
    }

    let savedArticles = getArticles();

    savedArticles.splice(index, 1);

    saveArticles(savedArticles);

    displayArticles();

}

function editArticle(index) {

    let savedArticles = getArticles();

    const article = savedArticles[index];

    articleTitle.value = article.title;
    articleDate.value = article.date;
    articleContentTop.value = article.contentTop;
    articleImage.value = article.image;
    articleYoutube.value = article.youtube;
    articleContentBottom.value = article.contentBottom;

    editingArticleIndex = index;

addArticle.textContent = "Save Changes";

}


onlineButton.addEventListener("click", function() {
    streamers[Number(streamerSelect.value)].status = "online";
    saveStreamers(streamers);
    displayStreamers();
});


awayButton.addEventListener("click", function() {
    streamers[Number(streamerSelect.value)].status = "away";
    saveStreamers(streamers);
    displayStreamers();
});


offlineButton.addEventListener("click", function() {
    streamers[Number(streamerSelect.value)].status = "offline";
    saveStreamers(streamers);
    displayStreamers();
});

addStreamer.addEventListener("click", function() {

    const newStreamer = {
    name: streamerName.value,
    platform: streamerPlatform.value,
    channel: streamerChannel.value,
    status: streamerStatus.value
};


    streamers.push(newStreamer);


  saveStreamers(streamers);

    displayStreamers();


    streamerName.value = "";
    streamerPlatform.value = "";
    streamerChannel.value = "";

});

updateAlert.addEventListener("click", function() {

    const newAlert = {
        type: alertType.value,
        message: alertMessage.value
    };

    saveAlert(newAlert);

    alertMessage.value = "";

});

clearAlert.addEventListener("click", function() {

    localStorage.removeItem("alert");

});

addArticle.addEventListener("click", function() {

    const newArticle = {
        title: articleTitle.value,
        date: articleDate.value,
        contentTop: articleContentTop.value,
        image: articleImage.value,
        youtube: articleYoutube.value,
        contentBottom: articleContentBottom.value
    };

   let savedArticles = getArticles();

if (editingArticleIndex === null) {

    savedArticles.unshift(newArticle);

} else {

    savedArticles[editingArticleIndex] = newArticle;

    editingArticleIndex = null;

    addArticle.textContent = "Publish Article";

}

saveArticles(savedArticles);

console.log("Article saved!");

articleTitle.value = "";
articleDate.value = "";
articleContentTop.value = "";
articleImage.value = "";
articleYoutube.value = "";
articleContentBottom.value = "";

});


displayStreamers();
loadStreamerDropdown();
displayCurrentAlert();
displayArticles();