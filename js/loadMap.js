//Width and height of map
const width = 1280;
const height = 580;

// D3 Projection
const projection = d3
  .geoAlbersUsa()
  .translate([width / 2.3, height / 2]) // translate to center of screen
  .scale([1000]); // scale things down so see entire US

// Define path generator
const path = d3
  .geoPath() // path generator that will convert GeoJSON to SVG paths
  .projection(projection); // tell path generator to use albersUsa projection

const googleSheetsLink =
  "https://sheets.googleapis.com/v4/spreadsheets/1rp9DbKZ6S1XxXAisAy-MPLqzeLyECViiXDl00WouV2g/values/Sheet1?key=AIzaSyDHFE1H6dDiIKz6tILi0lGE3FeKdH0ZapA";

const usMap =
  "https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json";
let statesVisited = [];
let placesVisitedLocations = [];
let placesVisitedArray = [];

let locMap = {};
let googleMapsAPILink =
  "https://maps.googleapis.com/maps/api/geocode/json?address=";

// please don't steal my API key- too lazy to hide it
let apiKey = "&key=AIzaSyDHFE1H6dDiIKz6tILi0lGE3FeKdH0ZapA";

async function placesToCoords(placesList) {
  let places_not_cached = [];
  for (const place of placesList) {
    if (localStorage.getItem(place.name) !== null) {
      console.log("found in storage: " + place.name);
      const coord = JSON.parse(localStorage.getItem(place.name));

      placesVisitedLocations.push(coord);
      locMap[coord[0] + coord[1]] = place.name;
    } else {
      places_not_cached.push(place);
    }
  }
  console.log(`number cached: ${placesList.length - places_not_cached.length}`);

  const promises = places_not_cached.map(individualPlaceToCoords);
  await Promise.all(promises)
    .then(function (data) {
      for (const [i, place] of data.entries()) {
        if (place.status == "OK") {
          latLongObj = place.results[0].geometry.location;
          const loc = [latLongObj.lng, latLongObj.lat];
          placesVisitedLocations.push(loc);
          locMap[latLongObj.lng + latLongObj.lat] = placesList[i].name;

          localStorage.setItem(place.name, JSON.stringify(loc));
        } else {
          console.log(
            `no data found for ${JSON.stringify(placesList[i].name)}`
          );
        }
      }
    })
    .catch(function (error) {
      console.log(error);
    });
}

function individualPlaceToCoords(place) {
  const gmapsAPISearchString = googleMapsAPILink + place.name + apiKey;
  return d3.json(gmapsAPISearchString);
}

function getNameFromCoords(coords) {
  const hash = coords[0] + coords[1];
  return locMap[hash];
}

function getColorFromCoords(coords) {
  const name = getNameFromCoords(coords);
  const matchingPlace = placesVisitedArray.find((place) => place.name == name);
  if (matchingPlace.type == "school") {
    return "blue";
  }
  return "green";
}

async function loadMap() {
  let mapData = await d3.json(usMap);

  // ["State", "Schools Visited", "National Parks Visited"]
  let statesData = await d3.json(googleSheetsLink);

  // remove first from array
  statesData.values.shift();

  // parse spreadsheet data to create array of all places
  statesData.values.forEach((state) => {
    statesVisited.push(state[0]);
    const schoolsvisitedString = state[1] || "";
    const npsvisitedString = state[2] || "";

    const schoolsVisitedInCurrState =
      schoolsvisitedString.length > 0 ? schoolsvisitedString.split(", ") : [];
    const npsVisitedInCurrState =
      npsvisitedString.length > 0 ? npsvisitedString.split(", ") : [];

    schoolsVisitedInCurrState.forEach((school) => {
      placesVisitedArray.push({ name: school, type: "school" });
    });
    npsVisitedInCurrState.forEach((nps) => {
      placesVisitedArray.push({ name: nps, type: "national park" });
    });
  });

  d3.select("body").append("div").attr("id", "tooltip");

  let svg = d3
    .select("div#map")
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  svg
    .append("g")
    .attr("class", "states")
    .selectAll("path")
    .data(mapData.features)
    .enter()
    .append("path")
    .attr("d", path)
    .classed("been-to", function (d) {
      return statesVisited.includes(d.properties.name);
    });

  await placesToCoords(placesVisitedArray);

  svg
    .selectAll("circle")
    .data(placesVisitedLocations)
    .enter()
    .append("circle")
    .attr("cx", function (d) {
      return projection(d)[0];
    })
    .attr("cy", function (d) {
      return projection(d)[1];
    })
    .attr("r", "4.5px")
    .attr("fill", function (d) {
      return getColorFromCoords(d);
    })
    .on("mouseover", function (d) {
      d3.select("#tooltip").style("opacity", 1).text(getNameFromCoords(d));
    })
    .on("mousemove", function () {
      d3.select("#tooltip")
        .style("left", d3.event.pageX + 10 + "px")
        .style("top", d3.event.pageY + 10 + "px");
    })
    .on("mouseout", function () {
      d3.select("#tooltip").style("opacity", 0);
    });

  const numschools = placesVisitedArray.filter(
    (place) => place.type == "school"
  ).length;
  const infoText =
    "States visited: " +
    statesVisited.length +
    "</br> Colleges visited: " +
    numschools +
    "</br> National Parks visited: " +
    (placesVisitedArray.length - numschools);
  document.getElementById("numbers").innerHTML = infoText;
}

loadMap();
