import importlib.util
import unittest
from pathlib import Path

spec=importlib.util.spec_from_file_location('ingest',Path(__file__).resolve().parents[1]/'scripts'/'ingest.py')
ingest=importlib.util.module_from_spec(spec)
spec.loader.exec_module(ingest)

class IngestionTests(unittest.TestCase):
    def test_agency_missing_data_and_spurs(self):
        row={'SID':'2013306N07162','SEASON':'2013','NAME':'HAIYAN','TRACK_TYPE':'main','LAT':'7','LON':'162','ISO_TIME':'2013-11-02 00:00:00','WMO_AGENCY':'tokyo','WMO_WIND':'60','WMO_PRES':'980'}
        later={**row,'ISO_TIME':'2013-11-02 06:00:00','WMO_WIND':'','WMO_PRES':''}
        alternate={**later,'ISO_TIME':'2013-11-02 09:00:00','TRACK_TYPE':'PROVISIONAL_spur'}
        storm=ingest.convert([row,later,alternate])[0]
        self.assertEqual(storm['name'],'Haiyan')
        self.assertEqual(storm['points'],2)
        self.assertEqual(storm['track'][0]['averagingMinutes'],10)
        self.assertEqual(storm['track'][0]['agency'],'tokyo')
        self.assertIsNone(storm['track'][1]['wind'])
        self.assertIsNone(storm['track'][1]['pressure'])
        self.assertEqual(storm['peakWind'],60)
    def test_no_sentinel_values(self):
        for value in ['', '-9999', 'NaN', None]:
            self.assertIsNone(ingest.number(value))

if __name__=='__main__':unittest.main()
