// store map of country codes to country names in memory
const countryCodeMap = {};

const getRandomColor = () => {
  var letters = "0123456789ABCDEF";
  var color = "#";
  for (var i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
};

const transformData = (data) =>
  Object.keys(data || {})
    .filter((year) => {
      return year < 2025;
    })
    .map((year) => ({
      x: year,
      y: data[year],
    }));

const renderLineGraph = (countryData) => {
  // set the dimensions and margins of the graph

  // get max GDP per capita across all countries
  const maxGDP = Math.max(
    ...countryData.map((country) => {
      return Math.max(...Object.values(country.data || {}));
    })
  );

  // X scale and Axis
  const x = d3
    .scaleLinear()
    .domain([1980, 2030]) // years
    .range([0, width]);

  svG
    .append("g")
    .attr("transform", "translate(0," + height + ")")
    .call(d3.axisBottom(x));

  // Y scale and Axis
  var y = d3.scaleLinear().domain([0, maxGDP]).range([height, 0]);
  svG.append("g").call(d3.axisLeft(y));

  for (country of countryData) {
    if (!country.data) continue; // don't plot if no data

    svG
      .append("path")
      .datum(transformData(country.data))
      .attr("fill", "none")
      .attr("stroke", getRandomColor()) // TODO: hardcode USA as red/white/blue gradient stroke
      .attr("stroke-width", 3)
      .attr("class", "country_line")
      .attr(
        "d",
        d3
          .line()
          .x((d) => x(d.x))
          .y((d) => y(d.y))
      );
  }

  // append a g for all the mouse over nonsense
  var mouseG = svG.append("g").attr("class", "mouse-over-effects");

  // this is the vertical line
  mouseG
    .append("path")
    .attr("class", "mouse-line")
    .style("stroke", "black")
    .style("stroke-width", "1px")
    .style("opacity", "0");

  // keep a reference to all our lines
  var lines = document.getElementsByClassName("country_line");

  // here's a g for each circle on the line
  var mousePerLine = mouseG
    .selectAll(".mouse-per-line")
    .data(d3.range(lines.length))
    .enter()
    .append("g")
    .attr("class", "mouse-per-line");

  // the circle
  mousePerLine
    .append("circle")
    .attr("r", 3)
    .style("stroke", "black")
    .style("fill", "black")
    .style("stroke-width", "1px")
    .style("opacity", "0");

  // rect to capture mouse movements
  mouseG
    .append("svg:rect")
    .attr("width", width)
    .attr("height", height)
    .attr("fill", "none")
    .attr("pointer-events", "all")
    .on("mousemove", function () {
      // mouse moving over canvas
      var mouse = d3.mouse(this);
      const year = Math.round(x.invert(mouse[0]));

      // if no data, don't do anything
      if (year < 1980 || year > 2024) {
        d3.select(".mouse-line").style("opacity", "0");
        d3.selectAll(".mouse-per-line circle").style("opacity", "0");
        d3.selectAll(".mouse-per-line text").style("opacity", "0");
      } else {
        d3.select(".mouse-line").style("opacity", "1");
        d3.selectAll(".mouse-per-line circle").style("opacity", "1");
        d3.selectAll(".mouse-per-line text").style("opacity", "1");
      }

      // move the vertical line
      d3.select(".mouse-line").attr("d", function () {
        var d = "M" + mouse[0] + "," + height;
        d += " " + mouse[0] + "," + 0;
        return d;
      });

      // position the circles
      d3.selectAll(".mouse-per-line").attr("transform", function (d, i) {
        var beginning = 0,
          end = lines[i].getTotalLength(),
          target = null;

        while (true) {
          target = Math.floor((beginning + end) / 2);
          pos = lines[i].getPointAtLength(target);
          if ((target === end || target === beginning) && pos.x !== mouse[0]) {
            break;
          }
          if (pos.x > mouse[0]) end = target;
          else if (pos.x < mouse[0]) beginning = target;
          else break; //position found
        }

        // return position
        return "translate(" + mouse[0] + "," + pos.y + ")";
      });

      // update the text
      let countryDataText = "";
      for (country of countryData) {
        const countryDataPoint = transformData(country.data).find(
          (dataPoint) => dataPoint.x == year
        );
        countryDataText += `${country.name}: $${Math.trunc(
          countryDataPoint?.y
        )} USD </br>`;
      }
      d3.select("#caption").html(`year: ${year} </br> ${countryDataText}`);
    });
};

const fetchCountryData = async (countryCode) => {
  const data = await fetch(
    `https://corsproxy.io/?https://www.imf.org/external/datamapper/api/v1/NGDPDPC/${countryCode}/`
  )
    .then((response) => response.json())
    .catch((error) => console.error(error));

  if (!data.values) {
    // alert user that no data was found
    alert(`Data not available for ${countryCode}`);

    return null;
  }

  const cleanedData = data.values["NGDPDPC"][countryCode];
  return cleanedData;
};

const loadAndRenderGraph = async (countryCodeList) => {
  const finalCountryData = await Promise.all(
    countryCodeList.map(async (countryCode) => {
      const data = await fetchCountryData(countryCode);

      return {
        name: countryCodeMap[countryCode],
        data: data,
      };
    })
  );

  renderLineGraph(finalCountryData);
};

const addCountryOptions = async () => {
  const data = await fetch(
    "https://corsproxy.io/?https://www.imf.org/external/datamapper/api/v1/countries"
  )
    .then((response) => response.json())
    .catch((error) => console.error(error));

  // set options for the select element
  const select = document.getElementById("countries_selector");

  // create new set
  select.innerHTML = Object.keys(data.countries).map((countryKey) => {
    countryCodeMap[countryKey] = data.countries[countryKey].label;

    return (
      '<option value="' +
      countryKey +
      '"' +
      `${countryKey === "USA" ? "selected" : ""}>` +
      data.countries[countryKey].label +
      "</option>"
    );
  });

  // default select USA

  select.loadOptions();
};

function updateCountrySelections() {
  var selectedValues = Array.prototype.slice
    .call(document.querySelectorAll("#countries_selector option:checked"), 0)
    .map(function (v, i, a) {
      return v.value;
    });

  svG.selectAll("*").remove();
  loadAndRenderGraph(selectedValues);
}

const margin = { top: 50, right: 50, bottom: 30, left: 50 },
  width = 700 - margin.left - margin.right,
  height = 400 - margin.top - margin.bottom;

const svG = d3
  .select("#line_graph")
  .append("svg")
  .attr("width", width + margin.left + margin.right)
  .attr("height", height + margin.top + margin.bottom)
  .append("g")
  .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

addCountryOptions();

// default - US
loadAndRenderGraph(["USA"]);
