function getStreamers() {

   let saved = localStorage.getItem("streamers");

   if (saved) {
       return JSON.parse(saved);
   }

   localStorage.setItem(
       "streamers",
       JSON.stringify(defaultStreamers)
   );

   return defaultStreamers;

}


function saveStreamers(streamerData) {

    localStorage.setItem(
        "streamers",
        JSON.stringify(streamerData)
    );

}


function getAlert() {

   return JSON.parse(localStorage.getItem("alert"));

}


function saveAlert(alertData) {

    localStorage.setItem(
        "alert",
        JSON.stringify(alertData)
    );

}